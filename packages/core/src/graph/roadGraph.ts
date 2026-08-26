import { haversineM, pathLengthM } from '../geo/geometry.js';
import type { Junction, LatLng, RoadSegment } from '../types/domain.js';
import { TrafficLevel } from '../types/enums.js';

/**
 * Multiplier applied to free-flow travel time for each traffic level.
 * These are the numbers that make SMART-ER prefer a longer, faster route.
 */
export const TRAFFIC_DELAY_FACTOR: Record<TrafficLevel, number> = {
  [TrafficLevel.FREE_FLOW]: 0.85,
  [TrafficLevel.NORMAL]: 1,
  [TrafficLevel.SLOW]: 1.6,
  [TrafficLevel.HEAVY]: 2.6,
  [TrafficLevel.BLOCKED]: Number.POSITIVE_INFINITY,
};

/**
 * Seconds an emergency vehicle loses at a junction it does NOT hold green.
 * A corridor removes this penalty, which is precisely the time it buys.
 */
export const JUNCTION_DELAY_SECONDS: Record<TrafficLevel, number> = {
  [TrafficLevel.FREE_FLOW]: 4,
  [TrafficLevel.NORMAL]: 8,
  [TrafficLevel.SLOW]: 18,
  [TrafficLevel.HEAVY]: 32,
  [TrafficLevel.BLOCKED]: 60,
};

export interface GraphEdge {
  segment: RoadSegment;
  toJunctionId: string;
}

/**
 * Indexed, query-friendly view of the junction network.
 *
 * The graph is the road model SMART-ER reasons about. Google Maps supplies
 * geometry and traffic-aware travel times for drawing and for cross-checking
 * ETAs, but junction-level scheduling needs a network SMART-ER controls — a
 * corridor is a reservation over *these* nodes.
 */
export class RoadGraph {
  private readonly junctionById = new Map<string, Junction>();
  private readonly segmentById = new Map<string, RoadSegment>();
  private readonly outgoing = new Map<string, GraphEdge[]>();

  constructor(junctions: readonly Junction[], segments: readonly RoadSegment[]) {
    for (const junction of junctions) {
      this.junctionById.set(junction.id, junction);
      this.outgoing.set(junction.id, []);
    }
    for (const segment of segments) {
      this.segmentById.set(segment.id, segment);
      const edges = this.outgoing.get(segment.fromJunctionId);
      if (!edges) {
        throw new Error(`RoadGraph: segment ${segment.id} starts at unknown junction ${segment.fromJunctionId}`);
      }
      if (!this.junctionById.has(segment.toJunctionId)) {
        throw new Error(`RoadGraph: segment ${segment.id} ends at unknown junction ${segment.toJunctionId}`);
      }
      edges.push({ segment, toJunctionId: segment.toJunctionId });
    }
  }

  get junctions(): Junction[] {
    return [...this.junctionById.values()];
  }

  get segments(): RoadSegment[] {
    return [...this.segmentById.values()];
  }

  junction(id: string): Junction | undefined {
    return this.junctionById.get(id);
  }

  requireJunction(id: string): Junction {
    const junction = this.junctionById.get(id);
    if (!junction) throw new Error(`RoadGraph: unknown junction ${id}`);
    return junction;
  }

  segment(id: string): RoadSegment | undefined {
    return this.segmentById.get(id);
  }

  edgesFrom(junctionId: string): GraphEdge[] {
    return this.outgoing.get(junctionId) ?? [];
  }

  /** Replace the live traffic level on a segment. Returns false if unknown. */
  setTraffic(segmentId: string, traffic: TrafficLevel): boolean {
    const segment = this.segmentById.get(segmentId);
    if (!segment) return false;
    segment.traffic = traffic;
    return true;
  }

  /** Open or close a road. A blocked road is never routed over. */
  setBlocked(segmentId: string, blocked: boolean): boolean {
    const segment = this.segmentById.get(segmentId);
    if (!segment) return false;
    segment.blocked = blocked;
    return true;
  }

  /** The junction nearest to a coordinate. Entry point for origin/destination snapping. */
  nearestJunction(position: LatLng): Junction {
    let best: Junction | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const junction of this.junctionById.values()) {
      const distance = haversineM(position, junction.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = junction;
      }
    }
    if (!best) throw new Error('RoadGraph: network has no junctions');
    return best;
  }

  /** The `count` nearest junctions, closest first. */
  nearestJunctions(position: LatLng, count: number): Junction[] {
    return [...this.junctionById.values()]
      .map((junction) => ({ junction, d: haversineM(position, junction.position) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, Math.max(1, count))
      .map((entry) => entry.junction);
  }

  /**
   * Traffic-aware travel time across a segment, in seconds.
   *
   * `emergency` relaxes the speed model: an emergency vehicle with a corridor
   * still cannot exceed what the road physically allows in heavy traffic, but
   * it is not held by the same queueing as public traffic.
   */
  travelTimeSeconds(segment: RoadSegment, opts: { emergency?: boolean } = {}): number {
    if (segment.blocked) return Number.POSITIVE_INFINITY;
    const factor = TRAFFIC_DELAY_FACTOR[segment.traffic];
    if (!Number.isFinite(factor)) return Number.POSITIVE_INFINITY;
    // An emergency vehicle recovers part — never all — of the congestion penalty.
    const effectiveFactor = opts.emergency ? 1 + (factor - 1) * 0.45 : factor;
    const speedKph = segment.speedLimitKph;
    const speedMs = (speedKph * 1000) / 3600;
    if (speedMs <= 0) return Number.POSITIVE_INFINITY;
    return (segment.distanceM / speedMs) * effectiveFactor;
  }

  /** Geometry of a segment, falling back to a straight line between endpoints. */
  segmentPath(segment: RoadSegment): LatLng[] {
    if (segment.path.length >= 2) return segment.path;
    return [this.requireJunction(segment.fromJunctionId).position, this.requireJunction(segment.toJunctionId).position];
  }

  /** Concatenated geometry for an ordered list of segments, de-duplicating joints. */
  pathForSegments(segmentIds: readonly string[]): LatLng[] {
    const out: LatLng[] = [];
    for (const id of segmentIds) {
      const segment = this.segmentById.get(id);
      if (!segment) continue;
      const path = this.segmentPath(segment);
      for (const point of path) {
        const last = out[out.length - 1];
        if (last && last.lat === point.lat && last.lng === point.lng) continue;
        out.push(point);
      }
    }
    return out;
  }

  /** Sanity check used at boot and in tests: geometry must match declared length. */
  validate(): string[] {
    const problems: string[] = [];
    for (const segment of this.segmentById.values()) {
      if (segment.distanceM <= 0) {
        problems.push(`segment ${segment.id} has non-positive length`);
      }
      if (segment.path.length >= 2) {
        const geometric = pathLengthM(segment.path);
        const drift = Math.abs(geometric - segment.distanceM) / segment.distanceM;
        if (drift > 0.35) {
          problems.push(
            `segment ${segment.id} geometry (${Math.round(geometric)} m) disagrees with distanceM (${segment.distanceM} m)`,
          );
        }
      }
      if (segment.speedLimitKph <= 0) {
        problems.push(`segment ${segment.id} has non-positive speed limit`);
      }
    }
    for (const junction of this.junctionById.values()) {
      if (junction.approaches.length === 0) {
        problems.push(`junction ${junction.id} has no approaches`);
      }
      const approachIds = new Set(junction.approaches.map((a) => a.id));
      for (const approach of junction.approaches) {
        for (const conflicting of approach.conflictsWith) {
          if (!approachIds.has(conflicting)) {
            problems.push(`junction ${junction.id} approach ${approach.id} conflicts with unknown ${conflicting}`);
          }
        }
      }
    }
    return problems;
  }
}
