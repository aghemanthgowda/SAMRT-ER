import { haversineM, pathLengthM, projectDistanceAlongPath } from '../geo/geometry.js';
import type { RoadGraph } from '../graph/roadGraph.js';
import type { Corridor, Junction, JunctionAllocation, LatLng, Route } from '../types/domain.js';
import { CorridorStatus, JunctionState } from '../types/enums.js';
import { nextId } from '../util/id.js';
import { isoAdd, isoNow } from '../util/time.js';

/**
 * Rolling green corridor.
 *
 * The whole point of this engine is what it *refuses* to do: it never turns the
 * entire route green. Holding twelve junctions for one ambulance would stop a
 * whole district for the duration of the run. Instead a short window travels
 * with the vehicle:
 *
 *   behind it   RELEASED   handed straight back to public traffic
 *   at it       GREEN      the one junction actually being crossed
 *   just ahead  PREPARING  clearing its queue so it is empty on arrival
 *   beyond      NORMAL     untouched, running its own programme
 *
 * Everything else in the file is bookkeeping around that idea.
 */

export interface CorridorTuning {
  /**
   * Seconds of advance notice a junction needs to clear its standing queue.
   * The junction enters PREPARING this far ahead of the vehicle's arrival.
   */
  prepareLeadSeconds: number;
  /**
   * Seconds before arrival at which the junction actually goes GREEN.
   * Shorter than prepareLead — the green itself should be as brief as possible.
   */
  greenLeadSeconds: number;
  /** Seconds the junction stays green after the vehicle is predicted to enter. */
  occupancySeconds: number;
  /** How many junctions ahead may be PREPARING at once. */
  maxPreparingJunctions: number;
  /** Metres past a junction before it is considered cleared and released. */
  releaseDistanceM: number;
}

export const DEFAULT_CORRIDOR_TUNING: CorridorTuning = {
  prepareLeadSeconds: 35,
  greenLeadSeconds: 12,
  occupancySeconds: 8,
  maxPreparingJunctions: 1,
  releaseDistanceM: 35,
};

export interface CorridorPlanInput {
  route: Route;
  vehicleId: string;
  requestId: string;
  priority: number;
  graph: RoadGraph;
  tuning?: Partial<CorridorTuning>;
  /** Planning epoch. Windows are expressed relative to this. */
  now?: string;
}

/**
 * Build the full allocation schedule for a route.
 *
 * Every junction on the route gets a planned window, because the conflict
 * engine needs to know when the vehicle *will* be at J7 in order to detect
 * contention early. But planning a window is not the same as reserving one:
 * allocations start in NORMAL and only the rolling window is ever driven to
 * PREPARING/GREEN by `advanceCorridor`.
 */
export function planCorridor(input: CorridorPlanInput): Corridor {
  const tuning = { ...DEFAULT_CORRIDOR_TUNING, ...input.tuning };
  const now = input.now ?? isoNow();
  const arrivals = predictJunctionArrivals(input.route, input.graph);

  const allocations: JunctionAllocation[] = arrivals.map((arrival) => ({
    id: nextId('ALC'),
    junctionId: arrival.junctionId,
    corridorId: '',
    vehicleId: input.vehicleId,
    approachId: arrival.approachId,
    priority: input.priority,
    startsAt: isoAdd(now, Math.max(0, arrival.etaSeconds - tuning.greenLeadSeconds)),
    endsAt: isoAdd(now, arrival.etaSeconds + tuning.occupancySeconds),
    state: JunctionState.NORMAL,
    timeSlotted: false,
  }));

  const corridor: Corridor = {
    id: nextId('COR'),
    requestId: input.requestId,
    vehicleId: input.vehicleId,
    routeId: input.route.id,
    status: CorridorStatus.PENDING,
    junctionIds: input.route.junctionIds,
    allocations,
    preparingJunctionIds: [],
    releasedJunctionIds: [],
    createdAt: now,
  };

  for (const allocation of corridor.allocations) {
    allocation.corridorId = corridor.id;
  }
  return corridor;
}

export interface JunctionArrival {
  junctionId: string;
  approachId: string;
  /** Seconds from route start until the vehicle enters the junction. */
  etaSeconds: number;
  /** Metres from route start to the junction. */
  distanceM: number;
}

/**
 * Predict when — and where along the route polyline — the vehicle reaches each
 * junction.
 *
 * The two figures come from deliberately different sources:
 *
 *   distanceM   projected onto `route.path`, the same geometry the vehicle is
 *               actually driven along. This matters because that path is the
 *               real Google polyline whenever a key is configured, and its
 *               length will not match the graph's declared road distances.
 *               Measuring progress in one space and junction positions in
 *               another is how a corridor releases a junction the vehicle has
 *               not reached yet.
 *
 *   etaSeconds  accumulated from the traffic-aware segment travel times, which
 *               is the only place congestion is modelled. Geometry cannot tell
 *               you that MG Road is at a standstill.
 */
export function predictJunctionArrivals(route: Route, graph: RoadGraph): JunctionArrival[] {
  const arrivals: JunctionArrival[] = [];
  const path = route.path.length >= 2 ? route.path : [route.origin, route.destination.position];
  let cumulativeSeconds = 0;
  let lastDistanceM = 0;

  for (let i = 0; i < route.junctionIds.length; i += 1) {
    const junctionId = route.junctionIds[i]!;
    const junction = graph.junction(junctionId);
    if (!junction) continue;

    if (i === 0) {
      const approachM = haversineM(route.origin, junction.position);
      cumulativeSeconds = approachM / emergencySpeedMs();
    } else {
      const segment = route.segments.find(
        (ref) => ref.fromJunctionId === route.junctionIds[i - 1] && ref.toJunctionId === junctionId,
      );
      if (segment) {
        cumulativeSeconds += segment.travelTimeSeconds;
      } else {
        const previous = graph.junction(route.junctionIds[i - 1]!);
        const fallbackM = previous ? haversineM(previous.position, junction.position) : 0;
        cumulativeSeconds += fallbackM / emergencySpeedMs();
      }
    }

    // Junctions are visited in order, so progress along the path is monotonic
    // even where a route doubles back near itself and projection is ambiguous.
    const projected = projectDistanceAlongPath(junction.position, path);
    const distanceM = Math.max(projected, lastDistanceM);
    lastDistanceM = distanceM;

    arrivals.push({
      junctionId,
      approachId: approachForJunction(junction, route, i, graph),
      etaSeconds: Math.round(cumulativeSeconds),
      distanceM: Math.round(distanceM),
    });
  }

  return arrivals;
}

/** Which approach the vehicle enters the junction on, from the inbound bearing. */
function approachForJunction(junction: Junction, route: Route, index: number, graph: RoadGraph): string {
  const previousPoint: LatLng | undefined =
    index === 0 ? route.origin : graph.junction(route.junctionIds[index - 1]!)?.position;
  if (!previousPoint || junction.approaches.length === 0) {
    return junction.approaches[0]?.id ?? `${junction.id}-A`;
  }
  // Traffic entering the junction travels previous → junction.
  const inbound = bearing(previousPoint, junction.position);
  let best = junction.approaches[0]!;
  let bestDelta = 361;
  for (const approach of junction.approaches) {
    const delta = angularDelta(approach.bearing, inbound);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = approach;
    }
  }
  return best.id;
}

function bearing(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * toRad) * Math.cos(b.lat * toRad);
  const x =
    Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) -
    Math.sin(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos((b.lng - a.lng) * toRad);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angularDelta(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360) + 360) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function emergencySpeedMs(): number {
  return (45 * 1000) / 3600;
}

// ---------------------------------------------------------------------------
// Rolling window
// ---------------------------------------------------------------------------

export interface CorridorAdvanceInput {
  corridor: Corridor;
  route: Route;
  graph: RoadGraph;
  /** Live vehicle position from telemetry. */
  position: LatLng;
  /** Current ground speed, km/h. Used to project arrival at the next junction. */
  speedKph: number;
  tuning?: Partial<CorridorTuning>;
  now?: string;
}

export interface CorridorAdvanceResult {
  corridor: Corridor;
  /** Junctions whose state changed on this tick — the only ones to command. */
  changed: { junctionId: string; from: JunctionState; to: JunctionState }[];
  /** True once the vehicle has passed the final junction. */
  completed: boolean;
  /** Junction the vehicle is heading for, if any remain. */
  nextJunctionId?: string;
}

/**
 * Advance the rolling window one tick.
 *
 * Called on every telemetry update. Pure with respect to its inputs: it returns
 * a new corridor rather than mutating the caller's, so state transitions are
 * easy to test and easy to replay in the incident timeline.
 */
export function advanceCorridor(input: CorridorAdvanceInput): CorridorAdvanceResult {
  const tuning = { ...DEFAULT_CORRIDOR_TUNING, ...input.tuning };
  const now = input.now ?? isoNow();
  const arrivals = predictJunctionArrivals(input.route, input.graph);
  const travelled = projectDistanceAlongPath(input.position, input.route.path);
  const speedMs = Math.max(4, (input.speedKph * 1000) / 3600);

  // A destination frequently sits on — or within a few metres of — the last
  // junction on the route: a hospital entrance is right at the circle it is
  // named after. The vehicle then never travels `releaseDistanceM` *past* that
  // junction, so a purely geometric release test would hold it green forever.
  // Arriving is itself grounds for release.
  const routeLengthM = pathLengthM(input.route.path);
  const arrived = routeLengthM > 0 && travelled >= routeLengthM - tuning.releaseDistanceM;

  const changed: CorridorAdvanceResult['changed'] = [];
  const allocations = input.corridor.allocations.map((allocation) => ({ ...allocation }));
  const releasedJunctionIds = [...input.corridor.releasedJunctionIds];
  const preparingJunctionIds: string[] = [];
  let activeJunctionId: string | undefined;
  let nextJunctionId: string | undefined;
  let preparingBudget = tuning.maxPreparingJunctions;

  for (const allocation of allocations) {
    const arrival = arrivals.find((entry) => entry.junctionId === allocation.junctionId);
    if (!arrival) continue;

    const metresToJunction = arrival.distanceM - travelled;
    const secondsToJunction = metresToJunction / speedMs;
    const previous = allocation.state;

    let next: JunctionState;

    if (arrived) {
      // Destination reached — every junction goes back to public traffic.
      next = JunctionState.RELEASED;
    } else if (metresToJunction < -tuning.releaseDistanceM) {
      // Vehicle is clear of this junction — hand it back immediately.
      next = JunctionState.RELEASED;
    } else if (metresToJunction <= tuning.releaseDistanceM || secondsToJunction <= tuning.greenLeadSeconds) {
      next = JunctionState.GREEN;
    } else if (secondsToJunction <= tuning.prepareLeadSeconds && preparingBudget > 0) {
      next = JunctionState.PREPARING;
      preparingBudget -= 1;
    } else {
      next = JunctionState.NORMAL;
    }

    // A junction that has been released never re-enters the corridor: the
    // vehicle only travels one way along the route.
    if (previous === JunctionState.RELEASED) {
      next = JunctionState.RELEASED;
    }

    if (next !== previous) {
      changed.push({ junctionId: allocation.junctionId, from: previous, to: next });
      allocation.state = next;
      if (next === JunctionState.RELEASED) {
        allocation.releasedAt = now;
        if (!releasedJunctionIds.includes(allocation.junctionId)) {
          releasedJunctionIds.push(allocation.junctionId);
        }
      }
    }

    if (next === JunctionState.GREEN && !activeJunctionId) activeJunctionId = allocation.junctionId;
    if (next === JunctionState.PREPARING) preparingJunctionIds.push(allocation.junctionId);
    if (next !== JunctionState.RELEASED && !nextJunctionId) nextJunctionId = allocation.junctionId;
  }

  const completed = allocations.every((allocation) => allocation.state === JunctionState.RELEASED);

  const corridor: Corridor = {
    ...input.corridor,
    allocations,
    status: completed ? CorridorStatus.RELEASED : CorridorStatus.ACTIVE,
    activeJunctionId,
    preparingJunctionIds,
    releasedJunctionIds,
    releasedAt: completed ? (input.corridor.releasedAt ?? now) : input.corridor.releasedAt,
  };

  return { corridor, changed, completed, nextJunctionId };
}

/** Force every junction back to NORMAL — used on cancellation and completion. */
export function releaseCorridor(corridor: Corridor, now: string = isoNow()): CorridorAdvanceResult {
  const changed: CorridorAdvanceResult['changed'] = [];
  const allocations = corridor.allocations.map((allocation) => {
    if (allocation.state === JunctionState.RELEASED) return { ...allocation };
    changed.push({ junctionId: allocation.junctionId, from: allocation.state, to: JunctionState.RELEASED });
    return { ...allocation, state: JunctionState.RELEASED, releasedAt: now };
  });

  return {
    corridor: {
      ...corridor,
      allocations,
      status: CorridorStatus.RELEASED,
      activeJunctionId: undefined,
      preparingJunctionIds: [],
      releasedJunctionIds: allocations.map((allocation) => allocation.junctionId),
      releasedAt: now,
    },
    changed,
    completed: true,
  };
}

/** Shift one junction's window later — the time-slot resolution outcome. */
export function timeSlotAllocation(
  corridor: Corridor,
  junctionId: string,
  delaySeconds: number,
): Corridor {
  return {
    ...corridor,
    allocations: corridor.allocations.map((allocation) =>
      allocation.junctionId === junctionId
        ? {
            ...allocation,
            startsAt: isoAdd(allocation.startsAt, delaySeconds),
            endsAt: isoAdd(allocation.endsAt, delaySeconds),
            timeSlotted: true,
          }
        : allocation,
    ),
  };
}

/** Junctions this corridor currently holds — i.e. is disrupting public traffic at. */
export function heldJunctionIds(corridor: Corridor): string[] {
  return corridor.allocations
    .filter(
      (allocation) =>
        allocation.state === JunctionState.GREEN || allocation.state === JunctionState.PREPARING,
    )
    .map((allocation) => allocation.junctionId);
}
