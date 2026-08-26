import {
  DEFAULT_CORRIDOR_TUNING,
  advanceCorridor,
  nextId,
  planCorridor,
  releaseCorridor,
  validateSignalCommand,
  type Corridor,
  type JunctionRuntimeState,
  type Route,
  type SignalCommand,
} from '@smart-er/core';
import { CorridorStatus, DeviceStatus, JunctionState, SignalAspect } from '@smart-er/core';
import type { Store } from '../db/store.js';
import type { EventBus } from '../realtime/bus.js';
import type { TimelineService } from './timeline.js';

interface PendingTransition {
  corridorId: string;
  junctionId: string;
  state: JunctionState;
  from: JunctionState;
  attempts: number;
}

/**
 * Corridor runtime.
 *
 * Owns the pipeline the brief specifies, in that exact order:
 *
 *   route → conflict → corridor → SAFETY VALIDATOR → signal command → junction
 *
 * The corridor engine decides *what* each junction should be doing; this
 * service turns that into signal commands, puts every one of them through the
 * safety validator, and only then hands the survivors to the hardware layer. A
 * rejected command is recorded on the timeline rather than silently dropped —
 * a controller needs to see what the system refused to do and why.
 */
export class CorridorRuntime {
  /** Junction state as last driven, for dashboards and the safety validator. */
  private readonly junctionStates = new Map<string, JunctionRuntimeState>();

  /**
   * Junction transitions the safety validator or the hardware refused.
   *
   * A rejection is usually temporary — a minimum-green interval that has not
   * elapsed, or a conflicting approach still clearing — so the transition is
   * queued and re-asserted on the next tick rather than dropped. Dropping it
   * would leave the junction showing green while the corridor believed it had
   * been released, which is the one desync that must never happen: cross
   * traffic would stay stopped with nothing coming.
   */
  private readonly pending = new Map<string, PendingTransition>();

  /**
   * Last state actually logged per corridor/junction.
   *
   * A transition the validator defers is retried each tick, and without this
   * the timeline fills with the same "J3 preparing" line and the same
   * minimum-green rejection over and over. The record needs to say what
   * happened, once — a controller reading back through an incident should not
   * have to scroll past thirty identical lines to find the next real event.
   */
  private readonly lastLogged = new Map<string, JunctionState>();


  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
    private readonly timeline: TimelineService,
  ) {
    for (const junction of store.graph.junctions) {
      this.junctionStates.set(junction.id, {
        junctionId: junction.id,
        code: junction.code,
        state: JunctionState.NORMAL,
        aspect: SignalAspect.RED,
        deviceStatus: DeviceStatus.ONLINE,
      });
    }
  }

  /** Re-assert every transition still waiting on a clearance interval. */
  async retryPending(): Promise<void> {
    if (this.pending.size === 0) return;

    for (const [key, entry] of [...this.pending]) {
      const corridor = this.store.repositories.corridors.get(entry.corridorId);
      if (!corridor) {
        this.pending.delete(key);
        continue;
      }
      // Give up only after a bounded number of attempts, and never silently:
      // a junction that cannot be commanded is an operational problem.
      if (entry.attempts >= 8) {
        this.pending.delete(key);
        this.timeline.record({
          kind: 'signal.abandoned',
          message:
            `Gave up commanding ${entry.junctionId} to ${entry.state} after ${entry.attempts} attempts. ` +
            `The junction is running its own programme; the corridor will route around it.`,
          junctionId: entry.junctionId,
          vehicleId: corridor.vehicleId,
          corridorId: corridor.id,
        });
        continue;
      }

      entry.attempts += 1;
      const applied = await this.applyJunctionState(corridor, entry.junctionId, entry.state, entry.from, true);
      if (applied) this.pending.delete(key);
    }
  }

  states(): JunctionRuntimeState[] {
    return [...this.junctionStates.values()];
  }

  state(junctionId: string): JunctionRuntimeState | undefined {
    return this.junctionStates.get(junctionId);
  }

  /** Plan and persist a corridor for a route. It starts PENDING, holding nothing. */
  create(route: Route, requestId: string, priority: number): Corridor {
    const corridor = planCorridor({
      route,
      vehicleId: route.vehicleId,
      requestId,
      priority,
      graph: this.store.graph,
      now: this.store.now(),
    });

    this.store.repositories.corridors.put(corridor);
    this.bus.emit('corridor.created', corridor);
    this.timeline.record({
      kind: 'corridor.activated',
      message:
        `Rolling green corridor armed for ${route.vehicleId} over ${corridor.junctionIds.length} junctions ` +
        `(${corridor.junctionIds.join(' → ')}). Junctions are held one at a time as the vehicle approaches.`,
      vehicleId: route.vehicleId,
      corridorId: corridor.id,
      requestId,
      data: { junctionIds: corridor.junctionIds },
    });
    return corridor;
  }

  /**
   * Advance a corridor against the vehicle's current position and drive any
   * junction whose state changed.
   */
  async tick(corridor: Corridor, route: Route): Promise<Corridor> {
    const vehicleState = this.store.vehicleState(corridor.vehicleId);
    if (!vehicleState) return corridor;

    const result = advanceCorridor({
      corridor,
      route,
      graph: this.store.graph,
      position: vehicleState.position,
      speedKph: vehicleState.speedKph,
      now: this.store.now(),
    });

    for (const change of result.changed) {
      await this.applyJunctionState(result.corridor, change.junctionId, change.to, change.from);
    }

    this.store.repositories.corridors.put(result.corridor);
    if (result.changed.length > 0) {
      this.bus.emit('corridor.updated', result.corridor);
      this.bus.emit('junction.states', this.states());
    }

    if (result.completed && corridor.status !== CorridorStatus.RELEASED) {
      this.bus.emit('corridor.released', { corridorId: result.corridor.id, vehicleId: result.corridor.vehicleId });
      this.timeline.record({
        kind: 'corridor.released',
        message: `Corridor released for ${corridor.vehicleId}. All junctions returned to their normal programme.`,
        vehicleId: corridor.vehicleId,
        corridorId: corridor.id,
        requestId: corridor.requestId,
      });
    }

    return result.corridor;
  }

  /** Tear a corridor down — completion, cancellation or rerouting. */
  async release(corridor: Corridor, note: string): Promise<Corridor> {
    for (const key of [...this.pending.keys()]) {
      if (key.startsWith(`${corridor.id}:`)) this.pending.delete(key);
    }
    for (const key of [...this.lastLogged.keys()]) {
      if (key.includes(corridor.id)) this.lastLogged.delete(key);
    }
    const result = releaseCorridor(corridor, this.store.now());
    for (const change of result.changed) {
      await this.applyJunctionState(result.corridor, change.junctionId, JunctionState.RELEASED, change.from);
    }
    this.store.repositories.corridors.put(result.corridor);
    this.bus.emit('corridor.updated', result.corridor);
    this.bus.emit('corridor.released', { corridorId: result.corridor.id, vehicleId: result.corridor.vehicleId });
    this.bus.emit('junction.states', this.states());
    this.timeline.record({
      kind: 'corridor.released',
      message: note,
      vehicleId: corridor.vehicleId,
      corridorId: corridor.id,
      requestId: corridor.requestId,
    });
    return result.corridor;
  }

  // -- signal pipeline ------------------------------------------------------

  /**
   * Turn one junction-state transition into a validated signal command.
   *
   * PREPARING and GREEN both mean "give the emergency approach green": the
   * difference is lead time, not aspect. PREPARING goes green early so the
   * standing queue has cleared by the time the vehicle arrives — a green that
   * appears one second before an ambulance reaches a full junction achieves
   * nothing.
   */
  private async applyJunctionState(
    corridor: Corridor,
    junctionId: string,
    state: JunctionState,
    previous: JunctionState,
    isRetry = false,
  ): Promise<boolean> {
    const junction = this.store.junction(junctionId);
    if (!junction) return true;

    const allocation = corridor.allocations.find((entry) => entry.junctionId === junctionId);
    if (!allocation) return true;

    const controller = this.store.hardware.signals.get(junctionId);
    const deviceStatus = controller?.status() ?? DeviceStatus.OFFLINE;

    const aspect =
      state === JunctionState.GREEN || state === JunctionState.PREPARING
        ? SignalAspect.GREEN
        : SignalAspect.RED;

    const holdSeconds =
      state === JunctionState.GREEN
        ? DEFAULT_CORRIDOR_TUNING.occupancySeconds + DEFAULT_CORRIDOR_TUNING.greenLeadSeconds
        : state === JunctionState.PREPARING
          ? DEFAULT_CORRIDOR_TUNING.prepareLeadSeconds
          : 0;

    const command: SignalCommand = {
      id: nextId('CMD'),
      junctionId,
      deviceId: junction.hardwareDeviceId,
      approachId: allocation.approachId,
      aspect,
      holdSeconds,
      corridorId: corridor.id,
      vehicleId: corridor.vehicleId,
      issuedAt: this.store.now(),
      safetyApproved: false,
      safetyNotes: [],
    };

    // --- SAFETY VALIDATOR -------------------------------------------------
    const otherAllocations = this.store
      .activeCorridors()
      .flatMap((entry) => entry.allocations)
      .filter((entry) => entry.junctionId === junctionId);

    const verdict = validateSignalCommand(command, {
      junction,
      activeAllocations: otherAllocations,
      currentAspects: controller?.aspects() ?? new Map(),
      lastChangeAt: controller?.lastChangeAt() ?? new Map(),
      deviceOffline: deviceStatus === DeviceStatus.OFFLINE,
      now: this.store.now(),
    });

    const validated: SignalCommand = {
      ...command,
      safetyApproved: verdict.approved,
      safetyNotes: verdict.notes,
    };
    this.store.repositories.commands.put(validated);
    this.bus.emit('signal.command', validated);

    if (!verdict.approved) {
      const rejectionKey = `reject:${corridor.id}:${junctionId}:${state}`;
      const firstRejection = this.lastLogged.get(rejectionKey) !== state;
      this.lastLogged.set(rejectionKey, state);

      if (firstRejection) this.timeline.record({
        kind: 'safety.rejected',
        message: `Signal command for ${junction.code} rejected by the safety validator: ${verdict.notes.join(' ')}`,
        junctionId,
        vehicleId: corridor.vehicleId,
        corridorId: corridor.id,
        data: { notes: verdict.notes, aspect, requiredClearanceSeconds: verdict.requiredClearanceSeconds },
      });
      this.updateJunctionState(junctionId, {
        state: JunctionState.CONFLICT,
        deviceStatus,
      });
      this.queueRetry(corridor, junctionId, state, previous, isRetry);
      return false;
    }

    // --- HARDWARE ---------------------------------------------------------
    const ack = await this.store.hardware.signals.dispatch(validated);
    this.bus.emit('signal.ack', ack);

    if (!ack.accepted) {
      this.timeline.record({
        kind: 'signal.nack',
        message: `${junction.code} did not accept the ${aspect} command: ${ack.error ?? 'no reason given'}.`,
        junctionId,
        vehicleId: corridor.vehicleId,
        corridorId: corridor.id,
      });
      this.updateJunctionState(junctionId, {
        state: deviceStatus === DeviceStatus.OFFLINE ? JunctionState.OFFLINE : state,
        deviceStatus,
        lastLatencyMs: ack.latencyMs,
      });
      this.queueRetry(corridor, junctionId, state, previous, isRetry);
      return false;
    }

    this.store.hardware.status.heartbeat(junction.hardwareDeviceId, { lastLatencyMs: ack.latencyMs });

    this.updateJunctionState(junctionId, {
      state,
      aspect: ack.appliedAspect,
      deviceStatus: controller?.status() ?? DeviceStatus.ONLINE,
      heldForVehicleId: state === JunctionState.RELEASED ? undefined : corridor.vehicleId,
      corridorId: state === JunctionState.RELEASED ? undefined : corridor.id,
      lastAckAt: ack.receivedAt,
      lastLatencyMs: ack.latencyMs,
    });

    this.recordTransition(junction.code, junctionId, corridor, state, previous);
    return true;
  }

  private queueRetry(
    corridor: Corridor,
    junctionId: string,
    state: JunctionState,
    from: JunctionState,
    isRetry: boolean,
  ): void {
    const key = `${corridor.id}:${junctionId}`;
    const existing = this.pending.get(key);
    this.pending.set(key, {
      corridorId: corridor.id,
      junctionId,
      state,
      from,
      attempts: isRetry ? (existing?.attempts ?? 1) : 0,
    });
  }

  private recordTransition(
    code: string,
    junctionId: string,
    corridor: Corridor,
    state: JunctionState,
    previous: JunctionState,
  ): void {
    const messages: Partial<Record<JunctionState, string>> = {
      [JunctionState.PREPARING]: `${code} preparing — clearing its queue ahead of ${corridor.vehicleId}.`,
      [JunctionState.GREEN]: `${code} green for ${corridor.vehicleId}.`,
      [JunctionState.RELEASED]: `${code} released — ${corridor.vehicleId} has passed, junction back to public traffic.`,
    };
    const message = messages[state];
    if (!message) return;

    const key = `${corridor.id}:${junctionId}`;
    if (this.lastLogged.get(key) === state) return;
    this.lastLogged.set(key, state);

    this.timeline.record({
      kind: `junction.${state.toLowerCase()}`,
      message,
      junctionId,
      vehicleId: corridor.vehicleId,
      corridorId: corridor.id,
      requestId: corridor.requestId,
      data: { from: previous, to: state },
    });
  }

  private updateJunctionState(junctionId: string, patch: Partial<JunctionRuntimeState>): void {
    const existing = this.junctionStates.get(junctionId);
    if (!existing) return;
    this.junctionStates.set(junctionId, { ...existing, ...patch });
  }

  /** Refresh device status for every junction. Called each tick by the simulation. */
  syncDeviceStatus(): void {
    let changed = false;
    for (const junction of this.store.graph.junctions) {
      const device = this.store.device(junction.hardwareDeviceId);
      const status = device?.status ?? DeviceStatus.OFFLINE;
      const existing = this.junctionStates.get(junction.id);
      if (!existing || existing.deviceStatus === status) continue;

      this.junctionStates.set(junction.id, {
        ...existing,
        deviceStatus: status,
        state:
          status === DeviceStatus.OFFLINE
            ? JunctionState.OFFLINE
            : existing.state === JunctionState.OFFLINE
              ? JunctionState.NORMAL
              : existing.state,
      });
      changed = true;
    }
    if (changed) this.bus.emit('junction.states', this.states());
  }
}
