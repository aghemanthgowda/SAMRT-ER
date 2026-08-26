import { haversineM } from '../geo/geometry.js';
import { JUNCTION_DELAY_SECONDS, RoadGraph } from '../graph/roadGraph.js';
import type { LatLng, RouteCandidate, RouteSegmentRef } from '../types/domain.js';
import { RouteSource } from '../types/enums.js';
import { nextId } from '../util/id.js';
import { scoreCandidate, type CostContext } from './costModel.js';
import type {
  RouteMatrixCell,
  RouteMatrixInput,
  RouteMatrixProvider,
  RouteProvider,
  RouteRequestInput,
} from './RouteProvider.js';

/** Junctions currently reserved by other corridors, with the owning priority. */
export interface JunctionReservation {
  junctionId: string;
  vehicleId: string;
  priority: number;
}

export interface GraphRouteProviderOptions {
  /** Corridor reservations held by other vehicles at planning time. */
  reservations?: readonly JunctionReservation[];
  /** Priority of the vehicle being routed; used to decide what counts as a conflict. */
  priority?: number;
  costContext?: CostContext;
}

interface SearchNode {
  junctionId: string;
  cost: number;
  time: number;
  distance: number;
  parent?: SearchNode;
  viaSegmentId?: string;
}

/**
 * ETA-optimal routing over the SMART-ER junction network.
 *
 * Uses Dijkstra on traffic-aware travel time (not distance), then relaxes it
 * into a k-shortest-paths search so the controller can be shown genuine
 * alternatives — including one that avoids every contended junction.
 *
 * The brief's worked example falls straight out of this: a 6.0 km route with an
 * ETA of 6:45 beats a 5.2 km route with an ETA of 8:10, because distance is
 * never part of the objective.
 */
export class GraphRouteProvider implements RouteProvider, RouteMatrixProvider {
  readonly name = 'smart-er-graph';

  constructor(
    private readonly graph: RoadGraph,
    private readonly options: GraphRouteProviderOptions = {},
  ) {}

  async computeRoutes(input: RouteRequestInput): Promise<RouteCandidate[]> {
    return this.computeRoutesSync(input);
  }

  /**
   * Synchronous variant. The simulation loop plans routes inside a tick and
   * cannot await, so the real work lives here and `computeRoutes` wraps it.
   */
  computeRoutesSync(input: RouteRequestInput): RouteCandidate[] {
    const wanted = Math.max(1, input.alternatives ?? 3);
    const excludedJunctions = new Set(input.excludeJunctionIds ?? []);
    const excludedSegments = new Set(input.excludeSegmentIds ?? []);

    const originJunction = this.entryJunction(input.origin, excludedJunctions);
    const destinationJunction = this.entryJunction(input.destination.position, excludedJunctions);
    if (!originJunction || !destinationJunction) return [];

    const paths = this.kShortestPaths(
      originJunction.id,
      destinationJunction.id,
      wanted + 2,
      excludedJunctions,
      excludedSegments,
      Boolean(input.emergency),
    );

    const reservationByJunction = new Map<string, JunctionReservation>();
    for (const reservation of this.options.reservations ?? []) {
      reservationByJunction.set(reservation.junctionId, reservation);
    }
    const myPriority = this.options.priority ?? 0;

    const candidates = paths.map((path, index) =>
      this.toCandidate(path, input, reservationByJunction, myPriority, index),
    );

    const softAvoid = new Set(input.avoidJunctionIds ?? []);
    const context: CostContext = {
      ...this.options.costContext,
      softAvoidJunctionIds: softAvoid.size > 0 ? softAvoid : this.options.costContext?.softAvoidJunctionIds,
    };

    return candidates
      .map((candidate) => ({ ...candidate, cost: scoreCandidate(candidate, context) }))
      .filter((candidate) => Number.isFinite(candidate.cost))
      .sort((a, b) => a.cost - b.cost)
      .slice(0, wanted)
      .map((candidate, index) => ({ ...candidate, label: labelFor(index, candidate) }));
  }

  async computeMatrix(input: RouteMatrixInput): Promise<RouteMatrixCell[]> {
    const cells: RouteMatrixCell[] = [];
    for (let o = 0; o < input.origins.length; o += 1) {
      for (let d = 0; d < input.destinations.length; d += 1) {
        const origin = input.origins[o]!;
        const destination = input.destinations[d]!;
        const [best] = this.computeRoutesSync({
          origin,
          destination: { id: `matrix-${o}-${d}`, kind: 'INCIDENT_SITE', name: 'matrix', position: destination },
          alternatives: 1,
          emergency: input.emergency ?? true,
        });
        cells.push({
          originIndex: o,
          destinationIndex: d,
          distanceM: best?.distanceM ?? Number.POSITIVE_INFINITY,
          etaSeconds: best?.etaSeconds ?? Number.POSITIVE_INFINITY,
          reachable: Boolean(best),
        });
      }
    }
    return cells;
  }

  // -- internals ------------------------------------------------------------

  private entryJunction(position: LatLng, excluded: ReadonlySet<string>) {
    const nearby = this.graph.nearestJunctions(position, 6);
    return nearby.find((junction) => !excluded.has(junction.id));
  }

  /**
   * Yen's algorithm, trimmed to what a city network needs.
   * Returns up to `k` loopless paths ordered by travel time.
   */
  private kShortestPaths(
    startId: string,
    goalId: string,
    k: number,
    excludedJunctions: ReadonlySet<string>,
    excludedSegments: ReadonlySet<string>,
    emergency: boolean,
  ): string[][] {
    const first = this.shortestPath(startId, goalId, excludedJunctions, excludedSegments, emergency);
    if (!first) return [];

    const accepted: string[][] = [first];
    const heap: { path: string[]; time: number }[] = [];

    for (let round = 1; round < k; round += 1) {
      const previous = accepted[round - 1]!;
      for (let i = 0; i < previous.length - 1; i += 1) {
        const spurJunction = previous[i]!;
        const rootPath = previous.slice(0, i + 1);

        const bannedSegments = new Set(excludedSegments);
        for (const path of accepted) {
          if (path.length > i && sameArray(path.slice(0, i + 1), rootPath)) {
            const from = path[i]!;
            const to = path[i + 1];
            if (!to) continue;
            for (const edge of this.graph.edgesFrom(from)) {
              if (edge.toJunctionId === to) bannedSegments.add(edge.segment.id);
            }
          }
        }

        const bannedJunctions = new Set(excludedJunctions);
        for (const junctionId of rootPath.slice(0, -1)) bannedJunctions.add(junctionId);

        const spur = this.shortestPath(spurJunction, goalId, bannedJunctions, bannedSegments, emergency);
        if (!spur) continue;

        const total = [...rootPath.slice(0, -1), ...spur];
        if (hasDuplicates(total)) continue;
        if (accepted.some((path) => sameArray(path, total))) continue;
        if (heap.some((entry) => sameArray(entry.path, total))) continue;

        heap.push({ path: total, time: this.pathTravelTime(total, emergency) });
      }

      if (heap.length === 0) break;
      heap.sort((a, b) => a.time - b.time);
      const best = heap.shift();
      if (!best || !Number.isFinite(best.time)) break;
      accepted.push(best.path);
    }

    return accepted;
  }

  /** Dijkstra over traffic-aware travel time plus per-junction delay. */
  private shortestPath(
    startId: string,
    goalId: string,
    excludedJunctions: ReadonlySet<string>,
    excludedSegments: ReadonlySet<string>,
    emergency: boolean,
  ): string[] | undefined {
    if (startId === goalId) return [startId];
    if (excludedJunctions.has(startId) || excludedJunctions.has(goalId)) return undefined;

    const best = new Map<string, number>([[startId, 0]]);
    const open: SearchNode[] = [{ junctionId: startId, cost: 0, time: 0, distance: 0 }];
    const closed = new Set<string>();

    while (open.length > 0) {
      open.sort((a, b) => a.cost - b.cost);
      const node = open.shift()!;
      if (closed.has(node.junctionId)) continue;
      closed.add(node.junctionId);

      if (node.junctionId === goalId) return unwind(node);

      for (const edge of this.graph.edgesFrom(node.junctionId)) {
        const { segment } = edge;
        if (excludedSegments.has(segment.id)) continue;
        if (excludedJunctions.has(edge.toJunctionId)) continue;
        if (segment.blocked) continue;

        const travel = this.graph.travelTimeSeconds(segment, { emergency });
        if (!Number.isFinite(travel)) continue;

        // Crossing an intermediate junction costs time unless a corridor holds it.
        const junctionDelay =
          edge.toJunctionId === goalId ? 0 : JUNCTION_DELAY_SECONDS[segment.traffic] * (emergency ? 0.5 : 1);

        const time = node.time + travel + junctionDelay;
        if (!Number.isFinite(time)) continue;

        const known = best.get(edge.toJunctionId);
        if (known !== undefined && known <= time) continue;
        best.set(edge.toJunctionId, time);
        open.push({
          junctionId: edge.toJunctionId,
          cost: time,
          time,
          distance: node.distance + segment.distanceM,
          parent: node,
          viaSegmentId: segment.id,
        });
      }
    }
    return undefined;
  }

  private pathTravelTime(junctionIds: readonly string[], emergency: boolean): number {
    let total = 0;
    for (let i = 1; i < junctionIds.length; i += 1) {
      const segment = this.findSegment(junctionIds[i - 1]!, junctionIds[i]!);
      if (!segment) return Number.POSITIVE_INFINITY;
      const travel = this.graph.travelTimeSeconds(segment, { emergency });
      if (!Number.isFinite(travel)) return Number.POSITIVE_INFINITY;
      total += travel;
      if (i < junctionIds.length - 1) {
        total += JUNCTION_DELAY_SECONDS[segment.traffic] * (emergency ? 0.5 : 1);
      }
    }
    return total;
  }

  private findSegment(fromId: string, toId: string) {
    return this.graph.edgesFrom(fromId).find((edge) => edge.toJunctionId === toId)?.segment;
  }

  private toCandidate(
    junctionIds: string[],
    input: RouteRequestInput,
    reservations: ReadonlyMap<string, JunctionReservation>,
    myPriority: number,
    index: number,
  ): RouteCandidate {
    const segments: RouteSegmentRef[] = [];
    const segmentIds: string[] = [];
    let distanceM = 0;
    let etaSeconds = 0;

    for (let i = 1; i < junctionIds.length; i += 1) {
      const segment = this.findSegment(junctionIds[i - 1]!, junctionIds[i]!);
      if (!segment) continue;
      const travelTimeSeconds = this.graph.travelTimeSeconds(segment, { emergency: input.emergency });
      segments.push({
        roadSegmentId: segment.id,
        fromJunctionId: segment.fromJunctionId,
        toJunctionId: segment.toJunctionId,
        distanceM: segment.distanceM,
        travelTimeSeconds,
        traffic: segment.traffic,
      });
      segmentIds.push(segment.id);
      distanceM += segment.distanceM;
      etaSeconds += travelTimeSeconds;
      if (i < junctionIds.length - 1) {
        etaSeconds += JUNCTION_DELAY_SECONDS[segment.traffic] * (input.emergency ? 0.5 : 1);
      }
    }

    // Approach and egress legs between the true origin/destination and the network.
    const firstJunction = this.graph.junction(junctionIds[0]!);
    const lastJunction = this.graph.junction(junctionIds[junctionIds.length - 1]!);
    const approachM = firstJunction ? haversineM(input.origin, firstJunction.position) : 0;
    const egressM = lastJunction ? haversineM(lastJunction.position, input.destination.position) : 0;
    const localSpeedMs = (input.emergency ? 45 : 30) * (1000 / 3600);
    distanceM += approachM + egressM;
    etaSeconds += (approachM + egressM) / localSpeedMs;

    const path: LatLng[] = [
      input.origin,
      ...this.graph.pathForSegments(segmentIds),
      input.destination.position,
    ];

    const conflictingJunctionIds = junctionIds.filter((id) => {
      const reservation = reservations.get(id);
      return Boolean(reservation) && reservation!.priority >= myPriority;
    });

    const publicImpactScore = junctionIds.reduce((total, id) => {
      const junction = this.graph.junction(id);
      return total + (junction ? junction.averageThroughputVph / 60 : 0);
    }, 0);

    return {
      id: nextId('RC'),
      junctionIds,
      segments,
      distanceM: Math.round(distanceM),
      etaSeconds: Math.round(etaSeconds),
      path,
      source: RouteSource.GRAPH,
      conflictingJunctionIds,
      publicImpactScore: Math.round(publicImpactScore),
      cost: Number.POSITIVE_INFINITY,
      label: `Option ${index + 1}`,
    };
  }
}

function labelFor(index: number, candidate: RouteCandidate): string {
  if (index === 0) return 'Fastest';
  if (candidate.conflictingJunctionIds.length === 0) return 'Conflict-free';
  return `Alternative ${index}`;
}

function unwind(node: SearchNode): string[] {
  const out: string[] = [];
  let cursor: SearchNode | undefined = node;
  while (cursor) {
    out.unshift(cursor.junctionId);
    cursor = cursor.parent;
  }
  return out;
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function hasDuplicates(items: readonly string[]): boolean {
  return new Set(items).size !== items.length;
}
