import {
  computePublicImpact,
  pathLengthM,
  pointAtDistance,
  projectDistanceAlongPath,
  type Route,
  type SimulationState,
  type VehicleState,
} from '@smart-er/core';
import { RouteChoiceReason, TrafficLevel, VehicleStatus } from '@smart-er/core';
import { SeededRandom } from '@smart-er/core';
import { config } from '../config.js';
import type { Store } from '../db/store.js';
import type { EventBus } from '../realtime/bus.js';
import type { CorridorRuntime } from '../services/corridorRuntime.js';
import type { DispatchService } from '../services/dispatch.js';
import type { RoutingService } from '../services/routing.js';
import type { TimelineService } from '../services/timeline.js';
import { SCENARIOS, type ScenarioRunner } from './scenarios.js';

/**
 * The simulation.
 *
 * In Phase 1 this stands in for the physical world: it moves vehicles along
 * their route polylines, publishes GPS through the hardware abstraction layer,
 * varies traffic, and decides when a reroute is warranted. Everything above it
 * — dispatch, corridors, the safety validator — behaves exactly as it will when
 * an ESP32 fleet replaces it, because it feeds the system through the same
 * interfaces real hardware will.
 */
export class SimulationEngine {
  private timer: NodeJS.Timeout | undefined;
  private readonly random = new SeededRandom(0x51_a7e3);
  private elapsedSeconds = 0;
  private stepIndex = 0;
  private scenario: ScenarioRunner | undefined;
  private startedAt: string | undefined;
  private speed: number;
  private running = false;
  /** Vehicles the operator has manually taken off simulated GPS. */
  private readonly manualGps = new Set<string>();
  /** Last reroute per vehicle, so the system does not oscillate. */
  private readonly lastRerouteAt = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
    private readonly dispatch: DispatchService,
    private readonly corridors: CorridorRuntime,
    private readonly timeline: TimelineService,
    private readonly routing: RoutingService,
  ) {
    this.speed = config.simulation.speed;
  }

  state(): SimulationState {
    return {
      running: this.running,
      elapsedSeconds: Math.round(this.elapsedSeconds),
      speed: this.speed,
      ...(this.scenario ? { scenarioId: this.scenario.id, scenarioName: this.scenario.name } : {}),
      stepIndex: this.stepIndex,
      ...(this.startedAt ? { startedAt: this.startedAt } : {}),
    };
  }

  start(): void {
    if (this.timer) return;
    this.running = true;
    this.startedAt = this.startedAt ?? this.store.now();
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        console.error('[simulation] tick failed:', error);
      });
    }, config.simulation.tickMs);
    // Node should not be kept alive purely by the simulation timer.
    this.timer.unref?.();
    this.emitState();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.running = false;
    this.emitState();
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.25, Math.min(10, speed));
    this.emitState();
  }

  /** Load and begin a named demonstration scenario. */
  async startScenario(scenarioId: string): Promise<SimulationState> {
    const scenario = SCENARIOS.find((entry) => entry.id === scenarioId);
    if (!scenario) throw new Error(`Unknown scenario ${scenarioId}`);

    this.scenario = scenario;
    this.elapsedSeconds = 0;
    this.stepIndex = 0;
    this.startedAt = this.store.now();
    this.timeline.record({
      kind: 'simulation.scenario.started',
      message: `Scenario started: ${scenario.name}. ${scenario.description}`,
      data: { scenarioId, expectedOutcome: scenario.expectedOutcome },
    });
    this.start();
    return this.state();
  }

  async stopScenario(): Promise<SimulationState> {
    if (this.scenario) {
      this.timeline.record({
        kind: 'simulation.scenario.stopped',
        message: `Scenario stopped: ${this.scenario.name}.`,
      });
    }
    this.scenario = undefined;
    this.stepIndex = 0;
    this.emitState();
    return this.state();
  }

  /** Hand GPS for a vehicle to a real handset instead of the simulator. */
  setManualGps(vehicleId: string, manual: boolean): void {
    if (manual) this.manualGps.add(vehicleId);
    else this.manualGps.delete(vehicleId);
  }

  isManualGps(vehicleId: string): boolean {
    return this.manualGps.has(vehicleId);
  }

  // -- the tick -------------------------------------------------------------

  async tick(): Promise<void> {
    const deltaSeconds = (config.simulation.tickMs / 1000) * this.speed;
    this.elapsedSeconds += deltaSeconds;
    // Advance the shared timebase first: everything downstream — signal
    // clearance intervals, corridor windows, timeline entries — is stamped
    // from it, and must agree with how far vehicles are about to move.
    this.store.clock.advance(deltaSeconds);

    await this.runScenarioSteps();
    // Re-assert anything the safety validator or a junction refused last tick,
    // before computing new transitions on top of it.
    await this.corridors.retryPending();
    await this.moveVehicles(deltaSeconds);
    this.varyTraffic();
    await this.considerReroutes();

    this.store.hardware.status.sweep();
    this.corridors.syncDeviceStatus();
    this.bus.emit('hardware.updated', this.store.hardware.status.devices());
    this.bus.emit(
      'impact.updated',
      computePublicImpact({ junctions: this.store.graph.junctions, corridors: this.store.activeCorridors() }),
    );
    this.emitState();
  }

  private async runScenarioSteps(): Promise<void> {
    if (!this.scenario) return;
    while (this.stepIndex < this.scenario.steps.length) {
      const step = this.scenario.steps[this.stepIndex]!;
      if (step.at > this.elapsedSeconds) break;
      this.stepIndex += 1;
      try {
        await this.scenario.execute(step, {
          store: this.store,
          dispatch: this.dispatch,
          timeline: this.timeline,
          simulation: this,
        });
      } catch (error) {
        this.timeline.record({
          kind: 'simulation.step.failed',
          message: `Scenario step ${step.action} failed: ${(error as Error).message}`,
          data: { step },
        });
      }
    }
  }

  /**
   * Move every active vehicle along its route.
   *
   * Position is advanced along the route polyline — which is the real Google
   * geometry whenever the browser has supplied it — then published through the
   * simulated GPS provider so it arrives at the rest of the system with the
   * same jitter and dropout characteristics a real receiver has.
   */
  private async moveVehicles(deltaSeconds: number): Promise<void> {
    const updated: VehicleState[] = [];

    for (const state of this.store.repositories.vehicleStates.list()) {
      if (state.status !== VehicleStatus.ACTIVE && state.status !== VehicleStatus.REROUTING) continue;
      if (!state.activeRouteId) continue;

      const route = this.store.repositories.routes.get(state.activeRouteId);
      if (!route || route.path.length < 2) continue;

      const vehicle = this.store.vehicle(state.vehicleId);
      if (!vehicle) continue;

      const totalM = pathLengthM(route.path);
      const travelled = projectDistanceAlongPath(state.position, route.path);
      const speedKph = this.effectiveSpeed(vehicle.cruisingSpeedKph, route, travelled);
      const advanceM = (speedKph * 1000 * deltaSeconds) / 3600;
      const nextDistance = Math.min(totalM, travelled + advanceM);
      const point = pointAtDistance(route.path, nextDistance);

      // Publish through the hardware layer, exactly as an on-board unit would.
      const fix = this.manualGps.has(state.vehicleId)
        ? this.store.hardware.gps.read(state.vehicleId)
        : this.store.hardware.gps.publish(
            state.vehicleId,
            { lat: point.position.lat, lng: point.position.lng, heading: point.heading, speedKph },
            { emergencyActive: true },
          );

      const remainingM = Math.max(0, totalM - nextDistance);
      const etaSeconds = speedKph > 0 ? Math.round((remainingM / (speedKph * 1000)) * 3600) : undefined;

      const next: VehicleState = {
        ...state,
        // A failed receiver must not move the vehicle: the corridor holds its
        // last confirmed position rather than dead-reckoning through a junction.
        position: fix && fix.valid ? fix.position : state.position,
        heading: point.heading,
        speedKph: fix && fix.valid ? speedKph : 0,
        gpsOk: fix?.valid ?? false,
        gpsAccuracy: fix?.accuracy ?? 999,
        distanceRemainingM: Math.round(remainingM),
        ...(etaSeconds === undefined ? {} : { etaSeconds }),
        updatedAt: this.store.now(),
      };

      this.store.repositories.vehicleStates.put(next);
      this.store.hardware.status.heartbeat(vehicle.hardwareDeviceId, {
        signalStrength: fix?.valid ? 90 : 5,
      });

      // Advance the rolling corridor against the new position.
      if (next.corridorId) {
        const corridor = this.store.repositories.corridors.get(next.corridorId);
        if (corridor) {
          const advanced = await this.corridors.tick(corridor, route);
          const withNext: VehicleState = {
            ...this.store.vehicleState(state.vehicleId)!,
            nextJunctionId: firstUnreleasedJunction(advanced),
          };
          this.store.repositories.vehicleStates.put(withNext);
        }
      }

      updated.push(this.store.vehicleState(state.vehicleId)!);

      if (remainingM <= 25) {
        await this.dispatch.completeRequest(state.vehicleId);
      }
    }

    if (updated.length > 0) {
      this.bus.emit('vehicle.states', this.store.repositories.vehicleStates.list());
    }
  }

  /** Speed on the segment the vehicle is currently traversing. */
  private effectiveSpeed(cruisingSpeedKph: number, route: Route, travelledM: number): number {
    const arrivalShare = pathLengthM(route.path) > 0 ? travelledM / pathLengthM(route.path) : 0;
    const segmentIndex = Math.min(
      route.segments.length - 1,
      Math.floor(arrivalShare * Math.max(1, route.segments.length)),
    );
    const segment = route.segments[Math.max(0, segmentIndex)];
    const traffic = segment?.traffic ?? TrafficLevel.NORMAL;

    const factor: Record<TrafficLevel, number> = {
      [TrafficLevel.FREE_FLOW]: 1.05,
      [TrafficLevel.NORMAL]: 1,
      [TrafficLevel.SLOW]: 0.72,
      [TrafficLevel.HEAVY]: 0.48,
      [TrafficLevel.BLOCKED]: 0.12,
    };

    const jitter = this.random.between(0.94, 1.06);
    return Math.max(6, cruisingSpeedKph * factor[traffic] * jitter);
  }

  /**
   * Drift traffic conditions.
   *
   * Kept slow and small — traffic that thrashes between free-flow and gridlock
   * every second would trigger a reroute on every tick and make the system look
   * indecisive, which is exactly the failure mode the reroute guard exists to
   * prevent.
   */
  private varyTraffic(): void {
    if (!this.random.chance(0.06)) return;

    const segments = this.store.graph.segments;
    const segment = this.random.pick(segments);
    if (segment.blocked) return;

    const ladder: TrafficLevel[] = [
      TrafficLevel.FREE_FLOW,
      TrafficLevel.NORMAL,
      TrafficLevel.SLOW,
      TrafficLevel.HEAVY,
    ];
    const current = ladder.indexOf(segment.traffic);
    if (current < 0) return;

    const direction = this.random.chance(0.5) ? 1 : -1;
    const next = ladder[Math.max(0, Math.min(ladder.length - 1, current + direction))];
    if (!next || next === segment.traffic) return;

    this.store.graph.setTraffic(segment.id, next);
    // Both carriageways of a road usually congest together.
    const reverseId = `${segment.toJunctionId}-${segment.fromJunctionId}`;
    this.store.graph.setTraffic(reverseId, next);
    this.bus.emit('traffic.updated', this.store.graph.segments);
  }

  /**
   * Reroute only when it is materially worth it.
   *
   * The guards matter as much as the trigger: a reroute costs a corridor
   * teardown and changes what the crew is following, so a five-second saving is
   * not worth it, and neither is a second reroute ninety seconds after the last.
   */
  private async considerReroutes(): Promise<void> {
    const MIN_IMPROVEMENT_SECONDS = 25;
    const MIN_INTERVAL_MS = 60_000;
    const now = Date.now();

    for (const state of this.store.repositories.vehicleStates.list()) {
      if (state.status !== VehicleStatus.ACTIVE || !state.activeRouteId) continue;

      const lastAt = this.lastRerouteAt.get(state.vehicleId) ?? 0;
      if (now - lastAt < MIN_INTERVAL_MS) continue;

      const route = this.store.repositories.routes.get(state.activeRouteId);
      if (!route) continue;

      // A road on the current route has closed — this is not optional.
      const blockedSegment = route.segments.find(
        (segment) => this.store.graph.segment(segment.roadSegmentId)?.blocked,
      );
      if (blockedSegment) {
        this.lastRerouteAt.set(state.vehicleId, now);
        await this.dispatch.rerouteVehicle(
          state.vehicleId,
          RouteChoiceReason.REROUTED_ROAD_UNAVAILABLE,
          `${this.store.graph.segment(blockedSegment.roadSegmentId)?.name ?? 'A road'} on the active route is closed.`,
        );
        continue;
      }

      // A junction controller on the route has gone offline: its green can no
      // longer be confirmed, so the corridor must route around it.
      const offlineJunction = route.junctionIds.find((junctionId) => {
        const junction = this.store.junction(junctionId);
        return junction ? !this.store.isDeviceUsable(junction.hardwareDeviceId) : false;
      });
      if (offlineJunction) {
        this.lastRerouteAt.set(state.vehicleId, now);
        await this.dispatch.rerouteVehicle(
          state.vehicleId,
          RouteChoiceReason.REROUTED_JUNCTION_UNAVAILABLE,
          `Junction controller at ${offlineJunction} is unreachable; its green cannot be confirmed.`,
          [offlineJunction],
        );
        continue;
      }

      // Traffic has changed enough that a different route is materially faster.
      const candidates = this.routingCandidatesFor(state, route);
      const best = candidates[0];
      if (!best) continue;

      const currentEta = this.remainingEtaSeconds(state, route);
      const improvement = currentEta - best.etaSeconds;
      if (improvement < MIN_IMPROVEMENT_SECONDS) continue;
      if (sameJunctions(best.junctionIds, remainingJunctions(route, state))) continue;

      this.lastRerouteAt.set(state.vehicleId, now);
      await this.dispatch.rerouteVehicle(
        state.vehicleId,
        RouteChoiceReason.REROUTED_TRAFFIC,
        `Traffic on the active route has worsened; an alternative saves ${Math.round(improvement)} s.`,
      );
    }
  }

  /**
   * Candidate routes from the vehicle's current position, through the same
   * routing service dispatch uses — so reservations held by other corridors and
   * unreachable junction controllers are accounted for identically.
   */
  private routingCandidatesFor(state: VehicleState, route: Route) {
    return this.routing.candidates(
      {
        requestId: route.requestId,
        vehicleId: state.vehicleId,
        origin: state.position,
        destination: route.destination,
        priority: 0,
      },
      2,
    );
  }

  private remainingEtaSeconds(state: VehicleState, route: Route): number {
    if (state.etaSeconds !== undefined) return state.etaSeconds;
    const travelled = projectDistanceAlongPath(state.position, route.path);
    const remaining = Math.max(0, pathLengthM(route.path) - travelled);
    return Math.round((remaining / 12.5) * 1);
  }

  private emitState(): void {
    this.bus.emit('simulation.updated', this.state());
  }
}

function firstUnreleasedJunction(corridor: { allocations: { junctionId: string; releasedAt?: string }[] }) {
  return corridor.allocations.find((allocation) => !allocation.releasedAt)?.junctionId;
}

function remainingJunctions(route: Route, state: VehicleState): string[] {
  const index = state.nextJunctionId ? route.junctionIds.indexOf(state.nextJunctionId) : 0;
  return route.junctionIds.slice(Math.max(0, index));
}

function sameJunctions(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
