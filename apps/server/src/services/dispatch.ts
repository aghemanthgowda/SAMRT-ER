import {
  DEFAULT_CORRIDOR_TUNING,
  approachConflictMatrix,
  detectConflicts,
  isoAdd,
  nextId,
  predictJunctionArrivals,
  priorityForRequest,
  projectDistanceAlongPath,
  resolveConflict,
  timeSlotAllocation,
  type Conflict,
  type Corridor,
  type Destination,
  type EmergencyRequest,
  type JunctionArrival,
  type PlannedArrival,
  type Route,
  type VehicleState,
} from '@smart-er/core';
import {
  DestinationKind,
  IncidentStatus,
  RequestStatus,
  ResolutionStrategy,
  RouteChoiceReason,
  Severity,
  VehicleStatus,
  formatEta,
} from '@smart-er/core';
import { verifyVehicleIdentity } from '../auth/verification.js';
import type { Store } from '../db/store.js';
import type { EventBus } from '../realtime/bus.js';
import type { CorridorRuntime } from './corridorRuntime.js';
import type { NotificationService } from './notifications.js';
import type { RoutingService } from './routing.js';
import type { TimelineService } from './timeline.js';

export class DispatchError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DispatchError';
  }
}

export interface SubmitRequestInput {
  vehicleId: string;
  driverId: string;
  severity: Severity;
  destinationFacilityId?: string;
  destinationIncidentId?: string;
  destinationPoint?: { lat: number; lng: number; name?: string };
  note?: string;
  incidentId?: string;
}

/**
 * Dispatch orchestration.
 *
 * Everything between a driver pressing "request green corridor" and the
 * junctions on their route beginning to roll happens here: verification,
 * controller approval, route planning, conflict detection and resolution,
 * corridor arming, destination notification and completion.
 */
export class DispatchService {
  /** Observers notified when a run completes, with baseline and actual seconds. */
  private readonly completionListeners = new Set<(baselineSeconds: number, actualSeconds: number) => void>();

  /**
   * Contentions already acted on, keyed by junction and the pair of vehicles.
   *
   * The sweep runs continuously, so without this the same J2 conflict would be
   * re-detected and re-resolved every few seconds — rerouting a vehicle over
   * and over, and filling the timeline with the same decision.
   */
  private readonly handledConflicts = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
    private readonly routing: RoutingService,
    private readonly corridors: CorridorRuntime,
    private readonly notifications: NotificationService,
    private readonly timeline: TimelineService,
  ) {}

  /**
   * Subscribe to completed runs.
   *
   * The payload is the pair the improvement figure is derived from: what the
   * journey would have taken with no corridor, and what it actually took.
   */
  onCompletion(listener: (baselineSeconds: number, actualSeconds: number) => void): () => void {
    this.completionListeners.add(listener);
    return () => {
      this.completionListeners.delete(listener);
    };
  }

  // -- driver sign-on -------------------------------------------------------

  /** Bind a driver to a vehicle and bring it to STANDBY. */
  signOn(vehicleId: string, driverId: string): VehicleState {
    const verification = verifyVehicleIdentity(this.store, vehicleId, driverId);
    if (!verification.verified) {
      throw new DispatchError(
        `Vehicle verification failed: ${verification.failures.join(' ')}`,
        403,
        verification,
      );
    }

    const state = this.store.vehicleState(vehicleId);
    if (!state) throw new DispatchError(`Unknown vehicle ${vehicleId}`, 404);

    const updated: VehicleState = {
      ...state,
      status: VehicleStatus.STANDBY,
      driverId,
      gpsOk: true,
      updatedAt: this.store.now(),
    };
    this.store.repositories.vehicleStates.put(updated);
    this.bus.emit('vehicle.state', updated);

    this.timeline.record({
      kind: 'driver.authenticated',
      message: `Driver ${driverId} authenticated and verified on ${vehicleId}.`,
      vehicleId,
      data: { verification },
    });
    return updated;
  }

  signOff(vehicleId: string): VehicleState | undefined {
    const state = this.store.vehicleState(vehicleId);
    if (!state) return undefined;
    const updated: VehicleState = {
      ...state,
      status: VehicleStatus.OFFLINE,
      driverId: undefined,
      updatedAt: this.store.now(),
    };
    this.store.repositories.vehicleStates.put(updated);
    this.bus.emit('vehicle.state', updated);
    return updated;
  }

  // -- request lifecycle ----------------------------------------------------

  submitRequest(input: SubmitRequestInput): EmergencyRequest {
    const vehicle = this.store.vehicle(input.vehicleId);
    if (!vehicle) throw new DispatchError(`Unknown vehicle ${input.vehicleId}`, 404);

    const state = this.store.vehicleState(input.vehicleId);
    if (!state) throw new DispatchError(`No live state for ${input.vehicleId}`, 404);

    const existing = this.store.repositories.requests.find(
      (request) => request.vehicleId === input.vehicleId && isOpen(request),
    )[0];
    if (existing) {
      throw new DispatchError(
        `${vehicle.callSign} already has an open request (${existing.id}). Complete or cancel it first.`,
        409,
      );
    }

    const destination = this.resolveDestination(input);
    const request: EmergencyRequest = {
      id: nextId('REQ'),
      vehicleId: vehicle.id,
      driverId: input.driverId,
      organizationId: vehicle.organizationId,
      severity: input.severity,
      status: RequestStatus.PENDING,
      origin: state.position,
      destination,
      ...(input.note ? { note: input.note } : {}),
      ...(input.incidentId ? { incidentId: input.incidentId } : {}),
      createdAt: this.store.now(),
    };

    this.store.repositories.requests.put(request);
    this.store.repositories.vehicleStates.put({
      ...state,
      status: VehicleStatus.REQUESTED,
      activeRequestId: request.id,
      updatedAt: this.store.now(),
    });

    this.bus.emit('request.created', request);
    this.bus.emit('vehicle.state', this.store.vehicleState(vehicle.id)!);

    this.timeline.record({
      kind: 'request.submitted',
      message:
        `${vehicle.callSign} submitted a ${input.severity} emergency request to ${destination.name}` +
        `${input.note ? ` — ${input.note}` : ''}.`,
      vehicleId: vehicle.id,
      requestId: request.id,
      severity: input.severity,
    });
    this.timeline.record({
      kind: 'request.received',
      message: `Controller received request ${request.id} from ${vehicle.callSign}.`,
      vehicleId: vehicle.id,
      requestId: request.id,
    });

    // The controller is told immediately; nothing waits on a poll.
    this.notifications.send({
      audience: { role: 'CONTROLLER' },
      title: `${input.severity} request — ${vehicle.callSign}`,
      body: `${vehicle.callSign} requests a green corridor to ${destination.name}.`,
      severity: input.severity,
      requestId: request.id,
      vehicleId: vehicle.id,
    });

    return request;
  }

  private resolveDestination(input: SubmitRequestInput): Destination {
    if (input.destinationFacilityId) {
      const facility = this.store.facility(input.destinationFacilityId);
      if (!facility) throw new DispatchError(`Unknown destination facility ${input.destinationFacilityId}`, 404);
      return {
        id: `DST-${facility.id}`,
        kind: facility.kind,
        name: facility.name,
        position: facility.position,
        facilityId: facility.id,
      };
    }

    if (input.destinationIncidentId) {
      const incident = this.store.repositories.incidents.get(input.destinationIncidentId);
      if (!incident) throw new DispatchError(`Unknown incident ${input.destinationIncidentId}`, 404);
      return {
        id: `DST-${incident.id}`,
        kind: DestinationKind.INCIDENT_SITE,
        name: `${incident.code} — ${incident.address}`,
        position: incident.position,
        incidentId: incident.id,
      };
    }

    if (input.destinationPoint) {
      return {
        id: nextId('DST'),
        kind: DestinationKind.INCIDENT_SITE,
        name: input.destinationPoint.name ?? 'Map location',
        position: { lat: input.destinationPoint.lat, lng: input.destinationPoint.lng },
      };
    }

    throw new DispatchError('A destination facility, incident or map point is required.', 400);
  }

  /**
   * Approve a request: verify the identity chain again, plan a route, resolve
   * any junction conflicts it creates, arm the corridor and notify the
   * destination.
   */
  async approveRequest(requestId: string, controllerUserId: string): Promise<EmergencyRequest> {
    const request = this.store.repositories.requests.get(requestId);
    if (!request) throw new DispatchError(`Unknown request ${requestId}`, 404);
    if (request.status !== RequestStatus.PENDING) {
      throw new DispatchError(`Request ${requestId} is already ${request.status}.`, 409);
    }

    // Re-verify at approval time: a licence can lapse or a unit drop offline
    // between submission and the controller looking at it.
    const verification = verifyVehicleIdentity(this.store, request.vehicleId, request.driverId);
    if (!verification.verified) {
      return this.rejectRequest(requestId, controllerUserId, verification.failures.join(' '));
    }

    this.timeline.record({
      kind: 'vehicle.verified',
      message: `${request.vehicleId} verified — driver, operator and telemetry unit all confirmed.`,
      vehicleId: request.vehicleId,
      requestId,
      data: { verification },
    });

    const vehicle = this.store.vehicle(request.vehicleId)!;
    const state = this.store.vehicleState(request.vehicleId)!;
    const priority = priorityForRequest(request, vehicle.kind, state);

    const planned = this.routing.plan({
      requestId,
      vehicleId: request.vehicleId,
      origin: state.position,
      destination: request.destination,
      priority,
    });

    if (!planned) {
      return this.rejectRequest(
        requestId,
        controllerUserId,
        'No route to the destination is available on the current network state.',
      );
    }

    this.store.repositories.routes.put(planned.route);
    this.bus.emit('route.created', planned.route);
    this.timeline.record({
      kind: 'route.calculated',
      message: planned.route.explanation,
      vehicleId: request.vehicleId,
      requestId,
      data: {
        junctionIds: planned.route.junctionIds,
        etaSeconds: planned.route.etaSeconds,
        distanceM: planned.route.distanceM,
        alternatives: planned.candidates.map((candidate) => ({
          label: candidate.label,
          junctionIds: candidate.junctionIds,
          distanceM: candidate.distanceM,
          etaSeconds: candidate.etaSeconds,
          conflicts: candidate.conflictingJunctionIds,
        })),
      },
    });

    const corridor = this.corridors.create(planned.route, requestId, priority);

    const approved: EmergencyRequest = {
      ...request,
      status: RequestStatus.APPROVED,
      decidedAt: this.store.now(),
      decidedByUserId: controllerUserId,
      verification,
      routeId: planned.route.id,
      corridorId: corridor.id,
    };
    this.store.repositories.requests.put(approved);
    this.bus.emit('request.updated', approved);

    this.store.repositories.vehicleStates.put({
      ...state,
      status: VehicleStatus.ACTIVE,
      activeRouteId: planned.route.id,
      corridorId: corridor.id,
      etaSeconds: planned.route.etaSeconds,
      distanceRemainingM: planned.route.distanceM,
      nextJunctionId: planned.route.junctionIds[0],
      updatedAt: this.store.now(),
    });
    this.bus.emit('vehicle.state', this.store.vehicleState(request.vehicleId)!);

    this.timeline.record({
      kind: 'request.approved',
      message: `Request ${requestId} approved. ${vehicle.callSign} cleared to ${request.destination.name}, ETA ${formatEta(planned.route.etaSeconds)}.`,
      vehicleId: request.vehicleId,
      requestId,
      severity: request.severity,
    });

    this.notifyDestination(approved, planned.route);

    // Arming a corridor can create contention with corridors already running.
    await this.resolveConflictsFor(approved, planned.route, corridor, priority);

    return approved;
  }

  rejectRequest(requestId: string, controllerUserId: string, reason: string): EmergencyRequest {
    const request = this.store.repositories.requests.get(requestId);
    if (!request) throw new DispatchError(`Unknown request ${requestId}`, 404);

    const rejected: EmergencyRequest = {
      ...request,
      status: RequestStatus.REJECTED,
      decidedAt: this.store.now(),
      decidedByUserId: controllerUserId,
      rejectionReason: reason,
    };
    this.store.repositories.requests.put(rejected);
    this.bus.emit('request.updated', rejected);

    const state = this.store.vehicleState(request.vehicleId);
    if (state) {
      this.store.repositories.vehicleStates.put({
        ...state,
        status: VehicleStatus.STANDBY,
        activeRequestId: undefined,
        updatedAt: this.store.now(),
      });
      this.bus.emit('vehicle.state', this.store.vehicleState(request.vehicleId)!);
    }

    this.timeline.record({
      kind: 'request.rejected',
      message: `Request ${requestId} from ${request.vehicleId} rejected: ${reason}`,
      vehicleId: request.vehicleId,
      requestId,
      severity: request.severity,
    });

    this.notifications.send({
      audience: { role: 'DRIVER' },
      title: `Request declined — ${request.vehicleId}`,
      body: reason,
      severity: request.severity,
      requestId,
      vehicleId: request.vehicleId,
    });

    return rejected;
  }

  // -- destination notification --------------------------------------------

  private notifyDestination(request: EmergencyRequest, route: Route): void {
    const facilityId = request.destination.facilityId;
    if (facilityId) {
      const facility = this.store.facility(facilityId);
      this.notifications.send({
        audience: { facilityId },
        title: `Incoming ${request.severity.toLowerCase()} — ${request.vehicleId}`,
        body:
          `${request.vehicleId} is en route to ${facility?.name ?? 'your facility'}, ` +
          `ETA ${formatEta(route.etaSeconds)}.${request.note ? ` ${request.note}` : ''}`,
        severity: request.severity,
        requestId: request.id,
        vehicleId: request.vehicleId,
      });
      this.timeline.record({
        kind: 'destination.notified',
        message: `${facility?.name ?? facilityId} notified of inbound ${request.vehicleId}, ETA ${formatEta(route.etaSeconds)}.`,
        vehicleId: request.vehicleId,
        requestId: request.id,
      });
    }

    if (request.destination.incidentId) {
      const incident = this.store.repositories.incidents.get(request.destination.incidentId);
      if (incident) {
        const updated = {
          ...incident,
          status: IncidentStatus.DISPATCHED,
          assignedVehicleIds: [...new Set([...incident.assignedVehicleIds, request.vehicleId])],
        };
        this.store.repositories.incidents.put(updated);
        this.bus.emit('incident.updated', updated);
        if (incident.ownerFacilityId) {
          this.notifications.send({
            audience: { facilityId: incident.ownerFacilityId },
            title: `${request.vehicleId} dispatched to ${incident.code}`,
            body: `${request.vehicleId} is en route to ${incident.address}, ETA ${formatEta(route.etaSeconds)}.`,
            severity: incident.severity,
            requestId: request.id,
            vehicleId: request.vehicleId,
            incidentId: incident.id,
          });
        }
      }
    }
  }

  // -- conflict resolution --------------------------------------------------

  /**
   * Detect and resolve contention between the new corridor and those already
   * running, following the brief's order of preference: reroute first,
   * time-slot the single contended junction second, hold only as a last resort.
   */
  async resolveConflictsFor(
    request: EmergencyRequest,
    route: Route,
    corridor: Corridor,
    priority: number,
  ): Promise<Conflict[]> {
    const arrivals = this.plannedArrivals();
    const clearanceByJunctionId = new Map(
      this.store.graph.junctions.map((junction) => [junction.id, junction.clearanceSeconds]),
    );

    const conflicts = detectConflicts(arrivals, {
      clearanceByJunctionId,
      approachConflictsByJunction: this.approachConflicts(),
    }).filter(
      (conflict) =>
        conflict.primaryVehicleId === route.vehicleId || conflict.secondaryVehicleId === route.vehicleId,
    );

    const resolved: Conflict[] = [];

    for (const conflict of conflicts) {
      const key = conflictKey(conflict);
      if (this.handledConflicts.has(key)) continue;
      this.handledConflicts.add(key);

      this.store.repositories.conflicts.put(conflict);
      this.bus.emit('conflict.detected', conflict);
      this.timeline.record({
        kind: 'conflict.detected',
        message: conflict.explanation,
        junctionId: conflict.junctionId,
        vehicleId: conflict.secondaryVehicleId,
        requestId: request.id,
        data: { headwaySeconds: conflict.headwaySeconds },
      });

      const outcome = await this.applyResolution(conflict);
      if (outcome) resolved.push(outcome);
    }
    void corridor;
    void priority;

    return resolved;
  }

  /**
   * Re-check every running corridor for newly-emerged contention.
   *
   * Detecting conflicts only at approval is not enough. Two units approved
   * minutes apart can have arrival windows that do not overlap at the moment
   * of approval and converge as they travel — traffic slows one, a reroute
   * shortens the other. By the time they actually meet at the junction it is
   * too late to reroute anyone.
   *
   * Called on a slow cadence from the simulation loop, so contention is found
   * while there is still time to do something about it.
   */
  /** Approach compatibility per junction, rebuilt lazily — the network is static. */
  private approachMatrix?: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;

  private approachConflicts(): ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>> {
    this.approachMatrix ??= approachConflictMatrix(this.store.graph.junctions);
    return this.approachMatrix;
  }

  async sweepConflicts(): Promise<Conflict[]> {
    const running = this.store.activeCorridors();
    if (running.length < 2) {
      // Nothing can contend; drop the dedupe keys so a later pairing is fresh.
      this.handledConflicts.clear();
      return [];
    }

    const liveVehicles = new Set(running.map((corridor) => corridor.vehicleId));
    for (const key of [...this.handledConflicts]) {
      const [, first, second] = key.split(':');
      // Forget a pairing once either vehicle has finished.
      if (!liveVehicles.has(first ?? '') || !liveVehicles.has(second ?? '')) {
        this.handledConflicts.delete(key);
      }
    }

    const clearanceByJunctionId = new Map(
      this.store.graph.junctions.map((junction) => [junction.id, junction.clearanceSeconds]),
    );
    const detected = detectConflicts(this.plannedArrivals(), {
      clearanceByJunctionId,
      approachConflictsByJunction: this.approachConflicts(),
    });

    const resolved: Conflict[] = [];
    for (const conflict of detected) {
      const key = conflictKey(conflict);
      if (this.handledConflicts.has(key)) continue;
      this.handledConflicts.add(key);

      this.store.repositories.conflicts.put(conflict);
      this.bus.emit('conflict.detected', conflict);
      this.timeline.record({
        kind: 'conflict.detected',
        message: conflict.explanation,
        junctionId: conflict.junctionId,
        vehicleId: conflict.secondaryVehicleId,
        data: { headwaySeconds: conflict.headwaySeconds, source: 'sweep' },
      });

      const outcome = await this.applyResolution(conflict);
      if (outcome) resolved.push(outcome);
    }
    return resolved;
  }
  /**
   * Planned junction arrivals for every corridor currently running.
   *
   * Timing is measured from where each vehicle *is now*, not from where its
   * route started. A corridor armed thirty seconds ago has already consumed
   * thirty seconds of its schedule; using the original route ETAs would place
   * every running vehicle further from its junctions than it really is, and
   * genuine contention would go undetected.
   */
  private plannedArrivals(): PlannedArrival[] {
    const arrivals: PlannedArrival[] = [];
    const base = this.store.now();

    for (const corridor of this.store.activeCorridors()) {
      const route = this.store.repositories.routes.get(corridor.routeId);
      if (!route) continue;
      const state = this.store.vehicleState(corridor.vehicleId);
      if (!state) continue;

      const predicted = predictJunctionArrivals(route, this.store.graph);
      const travelledM = projectDistanceAlongPath(state.position, route.path);

      for (const arrival of predicted) {
        const allocation = corridor.allocations.find((entry) => entry.junctionId === arrival.junctionId);
        if (!allocation || allocation.releasedAt) continue;

        const remainingSeconds = remainingSecondsTo(predicted, arrival, travelledM);
        if (remainingSeconds === undefined) continue; // already passed

        arrivals.push({
          vehicleId: corridor.vehicleId,
          corridorId: corridor.id,
          routeId: route.id,
          junctionId: arrival.junctionId,
          // A time-slotted allocation has already been shifted, so use its window.
          arrivalAt: allocation.timeSlotted ? allocation.startsAt : isoAdd(base, remainingSeconds),
          approachId: arrival.approachId,
          priority: allocation.priority,
          occupancySeconds: JUNCTION_HOLD_SECONDS,
        });
      }
    }

    return arrivals;
  }

  private async applyResolution(conflict: Conflict): Promise<Conflict | undefined> {
    const primaryInfo = this.contenderInfo(conflict.primaryVehicleId);
    const secondaryInfo = this.contenderInfo(conflict.secondaryVehicleId);
    if (!primaryInfo || !secondaryInfo) return undefined;

    // The lower-priority vehicle is the one that yields.
    const [keeper, yielder] =
      primaryInfo.priority >= secondaryInfo.priority ? [primaryInfo, secondaryInfo] : [secondaryInfo, primaryInfo];

    const yieldingRoute = this.store.repositories.routes.get(yielder.routeId);
    if (!yieldingRoute) return undefined;

    const alternatives = this.routing
      .candidates(
        {
          requestId: yielder.requestId,
          vehicleId: yielder.vehicleId,
          origin: yielder.position,
          destination: yieldingRoute.destination,
          priority: yielder.priority,
          excludeJunctionIds: [conflict.junctionId],
        },
        3,
      )
      .filter((candidate) => !candidate.junctionIds.includes(conflict.junctionId));

    const junction = this.store.junction(conflict.junctionId);
    const outcome = resolveConflict({
      conflict,
      primary: {
        vehicleId: keeper.vehicleId,
        priority: keeper.priority,
        etaSeconds: keeper.etaSeconds,
        label: keeper.vehicleId,
      },
      secondary: {
        vehicleId: yielder.vehicleId,
        priority: yielder.priority,
        etaSeconds: yielder.etaSeconds,
        label: yielder.vehicleId,
      },
      secondaryAlternatives: alternatives,
      clearanceSeconds: junction?.clearanceSeconds ?? 6,
      primaryOccupancySeconds: JUNCTION_HOLD_SECONDS,
    });

    this.store.repositories.conflicts.put(outcome.conflict);
    this.bus.emit('conflict.resolved', outcome.conflict);
    this.timeline.record({
      kind: `conflict.${outcome.strategy.toLowerCase()}`,
      message: outcome.explanation,
      junctionId: conflict.junctionId,
      vehicleId: yielder.vehicleId,
      requestId: yielder.requestId,
      data: {
        strategy: outcome.strategy,
        originalEtaSeconds: outcome.conflict.originalEtaSeconds,
        newEtaSeconds: outcome.conflict.newEtaSeconds,
        timeSavedSeconds: outcome.conflict.timeSavedSeconds,
      },
    });

    if (outcome.strategy === ResolutionStrategy.REROUTE && outcome.newRoute) {
      await this.rerouteVehicle(
        yielder.vehicleId,
        RouteChoiceReason.CONFLICT_FREE_ALTERNATIVE,
        outcome.explanation,
        [conflict.junctionId],
      );
    } else if (outcome.strategy === ResolutionStrategy.TIME_SLOT && outcome.slotDelaySeconds) {
      const yieldingCorridor = this.store.repositories.corridors.get(yielder.corridorId);
      if (yieldingCorridor) {
        const slotted = timeSlotAllocation(yieldingCorridor, conflict.junctionId, outcome.slotDelaySeconds);
        this.store.repositories.corridors.put(slotted);
        this.bus.emit('corridor.updated', slotted);
      }
    }

    return outcome.conflict;
  }

  private contenderInfo(vehicleId: string) {
    const state = this.store.vehicleState(vehicleId);
    const request = this.store.repositories.requests.find(
      (entry) => entry.vehicleId === vehicleId && isOpen(entry),
    )[0];
    const corridor = this.store.repositories.corridors.find(
      (entry) => entry.vehicleId === vehicleId && entry.status !== 'RELEASED',
    )[0];
    if (!state || !request || !corridor) return undefined;

    const vehicle = this.store.vehicle(vehicleId);
    if (!vehicle) return undefined;

    return {
      vehicleId,
      requestId: request.id,
      routeId: corridor.routeId,
      corridorId: corridor.id,
      position: state.position,
      etaSeconds: state.etaSeconds ?? 600,
      priority: priorityForRequest(request, vehicle.kind, state),
    };
  }

  // -- rerouting ------------------------------------------------------------

  /**
   * Move a vehicle onto a new route.
   *
   * Rerouting is not free: it tears down a corridor that junctions have already
   * started preparing for, and it changes what the crew is being told. So it is
   * only ever done when the caller has established it is materially better, and
   * the reason is always recorded.
   */
  async rerouteVehicle(
    vehicleId: string,
    reason: RouteChoiceReason,
    explanation: string,
    excludeJunctionIds: string[] = [],
  ): Promise<Route | undefined> {
    const state = this.store.vehicleState(vehicleId);
    const request = this.store.repositories.requests.find(
      (entry) => entry.vehicleId === vehicleId && isOpen(entry),
    )[0];
    if (!state || !request) return undefined;

    const vehicle = this.store.vehicle(vehicleId);
    if (!vehicle) return undefined;

    const oldRoute = state.activeRouteId ? this.store.repositories.routes.get(state.activeRouteId) : undefined;
    const priority = priorityForRequest(request, vehicle.kind, state);

    const planned = this.routing.plan({
      requestId: request.id,
      vehicleId,
      origin: state.position,
      destination: request.destination,
      priority,
      excludeJunctionIds,
      reason,
      ...(oldRoute ? { supersedesRouteId: oldRoute.id } : {}),
    });
    if (!planned) return undefined;

    const improvementSeconds = oldRoute ? oldRoute.etaSeconds - planned.route.etaSeconds : 0;

    // Retire the previous corridor before arming the new one, so no junction is
    // left holding for a route the vehicle is no longer on.
    const previousCorridor = state.corridorId
      ? this.store.repositories.corridors.get(state.corridorId)
      : undefined;
    if (previousCorridor) {
      await this.corridors.release(previousCorridor, `Corridor for ${vehicleId} retired ahead of a reroute.`);
    }
    if (oldRoute) {
      // Broadcast the retirement. Dashboards filter the map to active routes,
      // so a route deactivated without an event stays drawn on every screen —
      // a controller would see a corridor that no longer exists.
      const retired = { ...oldRoute, active: false };
      this.store.repositories.routes.put(retired);
      this.bus.emit('route.updated', retired);
    }

    this.store.repositories.routes.put(planned.route);
    this.bus.emit('route.created', planned.route);

    const corridor = this.corridors.create(planned.route, request.id, priority);

    this.store.repositories.requests.put({ ...request, routeId: planned.route.id, corridorId: corridor.id });
    this.store.repositories.vehicleStates.put({
      ...state,
      status: VehicleStatus.ACTIVE,
      activeRouteId: planned.route.id,
      corridorId: corridor.id,
      etaSeconds: planned.route.etaSeconds,
      nextJunctionId: planned.route.junctionIds[0],
      updatedAt: this.store.now(),
    });
    this.bus.emit('vehicle.state', this.store.vehicleState(vehicleId)!);
    this.bus.emit('request.updated', this.store.repositories.requests.get(request.id)!);

    this.timeline.record({
      kind: 'route.rerouted',
      message:
        `${vehicleId} rerouted — ${explanation} ` +
        (oldRoute
          ? `Original ETA ${formatEta(oldRoute.etaSeconds)}, new ETA ${formatEta(planned.route.etaSeconds)}` +
            `${improvementSeconds > 0 ? `, improvement ${Math.round(improvementSeconds)} s` : ''}.`
          : ''),
      vehicleId,
      requestId: request.id,
      data: {
        reason,
        originalEtaSeconds: oldRoute?.etaSeconds,
        newEtaSeconds: planned.route.etaSeconds,
        improvementSeconds: Math.round(improvementSeconds),
        newJunctionIds: planned.route.junctionIds,
      },
    });

    this.notifications.send({
      audience: { role: 'DRIVER' },
      title: `${vehicleId} rerouted`,
      body: `New ETA ${formatEta(planned.route.etaSeconds)} via ${planned.route.junctionIds.join(' → ')}.`,
      severity: request.severity,
      requestId: request.id,
      vehicleId,
    });

    return planned.route;
  }

  // -- completion -----------------------------------------------------------

  async completeRequest(vehicleId: string, note = 'Destination reached.'): Promise<void> {
    const state = this.store.vehicleState(vehicleId);
    const request = this.store.repositories.requests.find(
      (entry) => entry.vehicleId === vehicleId && isOpen(entry),
    )[0];
    if (!state || !request) return;

    const corridor = state.corridorId ? this.store.repositories.corridors.get(state.corridorId) : undefined;
    if (corridor) {
      await this.corridors.release(
        corridor,
        `${vehicleId} reached ${request.destination.name}. Corridor released and all junctions returned to normal.`,
      );
    }
    if (state.activeRouteId) {
      const route = this.store.repositories.routes.get(state.activeRouteId);
      if (route) {
        const retired = { ...route, active: false };
        this.store.repositories.routes.put(retired);
        this.bus.emit('route.updated', retired);
      }
    }

    // Baseline: the same route with every junction contributing its ordinary
    // delay — what the run would have cost without a corridor. The route's own
    // ETA already assumes emergency treatment, so the difference is what the
    // corridor bought.
    const route = state.activeRouteId ? this.store.repositories.routes.get(state.activeRouteId) : undefined;
    const plannedRoute = route ?? (request.routeId ? this.store.repositories.routes.get(request.routeId) : undefined);
    if (plannedRoute) {
      const junctionCount = Math.max(1, plannedRoute.junctionIds.length);
      const baselineSeconds = plannedRoute.etaSeconds + junctionCount * AVERAGE_JUNCTION_DELAY_SECONDS;
      const actualSeconds = Math.max(
        1,
        (new Date(this.store.now()).getTime() - new Date(request.createdAt).getTime()) / 1000,
      );
      // A run cut short by a reset would otherwise report an absurd saving.
      const bounded = Math.min(actualSeconds, baselineSeconds * 1.5);
      for (const listener of this.completionListeners) listener(baselineSeconds, bounded);
    }

    const completed: EmergencyRequest = {
      ...request,
      status: RequestStatus.COMPLETED,
      completedAt: this.store.now(),
    };
    this.store.repositories.requests.put(completed);
    this.bus.emit('request.updated', completed);

    this.store.repositories.vehicleStates.put({
      ...state,
      status: VehicleStatus.ARRIVED,
      speedKph: 0,
      etaSeconds: 0,
      distanceRemainingM: 0,
      nextJunctionId: undefined,
      corridorId: undefined,
      activeRouteId: undefined,
      updatedAt: this.store.now(),
    });
    this.bus.emit('vehicle.state', this.store.vehicleState(vehicleId)!);

    this.timeline.record({
      kind: 'request.completed',
      message: `${vehicleId} arrived at ${request.destination.name}. ${note}`,
      vehicleId,
      requestId: request.id,
      severity: request.severity,
    });

    if (request.destination.facilityId) {
      this.notifications.send({
        audience: { facilityId: request.destination.facilityId },
        title: `${vehicleId} has arrived`,
        body: note,
        severity: request.severity,
        requestId: request.id,
        vehicleId,
      });
    }
    if (request.destination.incidentId) {
      const incident = this.store.repositories.incidents.get(request.destination.incidentId);
      if (incident) {
        const updated = { ...incident, status: IncidentStatus.ON_SCENE };
        this.store.repositories.incidents.put(updated);
        this.bus.emit('incident.updated', updated);
      }
    }
  }

  /** Close out an arrived vehicle and return it to standby. */
  confirmArrival(vehicleId: string): void {
    const state = this.store.vehicleState(vehicleId);
    if (!state) return;
    this.store.repositories.vehicleStates.put({
      ...state,
      status: VehicleStatus.COMPLETED,
      activeRequestId: undefined,
      updatedAt: this.store.now(),
    });
    this.bus.emit('vehicle.state', this.store.vehicleState(vehicleId)!);
    this.timeline.record({
      kind: 'arrival.confirmed',
      message: `Arrival of ${vehicleId} confirmed by the receiving facility.`,
      vehicleId,
    });
  }

  /**
   * Return the whole fleet to its starting state.
   *
   * "Reset" has to mean the network is genuinely back to how it started, not
   * merely that the open requests were cancelled. Vehicles are parked wherever
   * their last run ended, so without moving them back a second demonstration
   * begins with units already at their destinations — a request from there is
   * zero-distance and completes instantly, and the geometry that made the
   * scenario interesting is gone.
   */
  resetFleet(): void {
    for (const vehicle of this.store.repositories.vehicles.list()) {
      const state = this.store.vehicleState(vehicle.id);
      if (!state) continue;

      const reset: VehicleState = {
        ...state,
        status: VehicleStatus.OFFLINE,
        position: vehicle.standbyPosition,
        heading: 0,
        speedKph: 0,
        gpsOk: vehicle.active,
        gpsAccuracy: 8,
        driverId: undefined,
        activeRequestId: undefined,
        activeRouteId: undefined,
        corridorId: undefined,
        etaSeconds: undefined,
        distanceRemainingM: undefined,
        nextJunctionId: undefined,
        updatedAt: this.store.now(),
      };
      this.store.repositories.vehicleStates.put(reset);
      this.store.hardware.gps.setFailed(vehicle.id, false);
    }

    // Conflict history belongs to the run that produced it.
    for (const conflict of this.store.repositories.conflicts.list()) {
      this.store.repositories.conflicts.remove(conflict.id);
    }
    this.handledConflicts.clear();

    this.bus.emit('vehicle.states', this.store.repositories.vehicleStates.list());
    this.timeline.record({
      kind: 'simulation.reset',
      message: 'Simulation reset. All units returned to their standby posts and every junction to its normal programme.',
    });
  }

  /**
   * Return a completed unit to standby, ready for its next call.
   *
   * Without this a crew that has arrived is stuck: the vehicle sits in ARRIVED
   * or COMPLETED forever and the handset has nothing to move on to, so the only
   * way to take a second call is to sign out and back in. A shift does not work
   * that way.
   */
  returnToStandby(vehicleId: string): VehicleState | undefined {
    const state = this.store.vehicleState(vehicleId);
    if (!state) return undefined;
    if (state.status !== VehicleStatus.ARRIVED && state.status !== VehicleStatus.COMPLETED) {
      throw new DispatchError(
        `${vehicleId} is ${state.status} and cannot return to standby. Cancel the active request first.`,
        409,
      );
    }

    const updated: VehicleState = {
      ...state,
      status: VehicleStatus.STANDBY,
      activeRequestId: undefined,
      activeRouteId: undefined,
      corridorId: undefined,
      etaSeconds: undefined,
      distanceRemainingM: undefined,
      nextJunctionId: undefined,
      speedKph: 0,
      updatedAt: this.store.now(),
    };
    this.store.repositories.vehicleStates.put(updated);
    this.bus.emit('vehicle.state', updated);

    this.timeline.record({
      kind: 'vehicle.standby',
      message: `${vehicleId} returned to standby and is available for the next call.`,
      vehicleId,
    });
    return updated;
  }

  async cancelRequest(vehicleId: string, reason: string): Promise<void> {
    const request = this.store.repositories.requests.find(
      (entry) => entry.vehicleId === vehicleId && isOpen(entry),
    )[0];
    if (!request) return;

    const state = this.store.vehicleState(vehicleId);
    const corridor = state?.corridorId ? this.store.repositories.corridors.get(state.corridorId) : undefined;
    if (corridor) {
      await this.corridors.release(corridor, `Corridor for ${vehicleId} released — request cancelled.`);
    }

    this.store.repositories.requests.put({
      ...request,
      status: RequestStatus.CANCELLED,
      completedAt: this.store.now(),
      rejectionReason: reason,
    });
    this.bus.emit('request.updated', this.store.repositories.requests.get(request.id)!);

    if (state) {
      this.store.repositories.vehicleStates.put({
        ...state,
        status: VehicleStatus.STANDBY,
        activeRequestId: undefined,
        activeRouteId: undefined,
        corridorId: undefined,
        etaSeconds: undefined,
        nextJunctionId: undefined,
        updatedAt: this.store.now(),
      });
      this.bus.emit('vehicle.state', this.store.vehicleState(vehicleId)!);
    }

    this.timeline.record({
      kind: 'request.cancelled',
      message: `Request ${request.id} from ${vehicleId} cancelled: ${reason}`,
      vehicleId,
      requestId: request.id,
    });
  }
}

/**
 * How long a corridor actually holds a junction.
 *
 * This must match what the corridor engine does, not an idealised figure. That
 * engine turns a junction green `greenLeadSeconds` before the vehicle arrives
 * and only releases it once the vehicle is clear, so the real hold is the lead
 * plus the occupancy — roughly 20 s, not 8.
 *
 * Understating it is not a rounding error: the conflict engine concludes two
 * vehicles are comfortably separated, declines to reroute or time-slot either,
 * and the second one then arrives to find the junction still held by the first.
 * The safety validator catches that and refuses the green — correctly — but by
 * then it is too late to do anything except wait.
 */
const JUNCTION_HOLD_SECONDS = DEFAULT_CORRIDOR_TUNING.greenLeadSeconds + DEFAULT_CORRIDOR_TUNING.occupancySeconds;

/**
 * Stable key for a contention: one junction, one pair of vehicles, in a fixed
 * order so A-vs-B and B-vs-A are the same conflict.
 */
function conflictKey(conflict: Conflict): string {
  const [first, second] = [conflict.primaryVehicleId, conflict.secondaryVehicleId].sort();
  return `${conflict.junctionId}:${first}:${second}`;
}

/**
 * Delay a vehicle absorbs at a junction it does not hold green.
 *
 * Mid-range of the traffic-dependent figures in the road graph. Used only to
 * form the no-corridor baseline for the improvement statistic.
 */
const AVERAGE_JUNCTION_DELAY_SECONDS = 14;

function isOpen(request: EmergencyRequest): boolean {
  return request.status === RequestStatus.PENDING || request.status === RequestStatus.APPROVED;
}

/**
 * Seconds from the vehicle's current position until it reaches a junction.
 *
 * The arrivals table pairs a distance along the route with a traffic-aware time
 * from the route's start. Interpolating the vehicle's current distance against
 * that table converts progress into elapsed time using the same congestion
 * model the route was planned with, rather than assuming a constant speed.
 */
function remainingSecondsTo(
  arrivals: readonly JunctionArrival[],
  target: JunctionArrival,
  travelledM: number,
): number | undefined {
  if (travelledM >= target.distanceM) return undefined;

  let elapsedSeconds = 0;
  let previousDistance = 0;
  let previousSeconds = 0;

  for (const arrival of arrivals) {
    if (arrival.distanceM >= travelledM) {
      const span = arrival.distanceM - previousDistance;
      const ratio = span > 0 ? (travelledM - previousDistance) / span : 0;
      elapsedSeconds = previousSeconds + (arrival.etaSeconds - previousSeconds) * Math.max(0, Math.min(1, ratio));
      break;
    }
    previousDistance = arrival.distanceM;
    previousSeconds = arrival.etaSeconds;
    elapsedSeconds = arrival.etaSeconds;
  }

  return Math.max(0, Math.round(target.etaSeconds - elapsedSeconds));
}
