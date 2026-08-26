import type { Destination, LatLng, RouteCandidate } from '../types/domain.js';

/**
 * Anything that can propose routes between two points.
 *
 * Two implementations ship in Phase 1:
 *
 *   GraphRouteProvider   — SMART-ER's own junction network. Authoritative for
 *                          junction sequencing, works with no network access,
 *                          and is what the server plans corridors on.
 *
 *   GoogleRoutesProvider — the Maps JavaScript Routes library in the browser.
 *                          Supplies real road geometry, traffic-aware ETAs and
 *                          alternatives, which are fed back to enrich the plan.
 *
 * Nothing above this interface knows which one answered.
 */
export interface RouteRequestInput {
  origin: LatLng;
  destination: Destination;
  /** How many distinct candidates to return. */
  alternatives?: number;
  /** Junctions to avoid if an equally good route exists without them. */
  avoidJunctionIds?: readonly string[];
  /** Junctions that must not be used at all (hard constraint). */
  excludeJunctionIds?: readonly string[];
  /** Road segments that must not be used at all. */
  excludeSegmentIds?: readonly string[];
  /** Departure time for traffic-aware planning. Defaults to now. */
  departAt?: Date;
  /** Emergency vehicles are modelled with reduced congestion penalty. */
  emergency?: boolean;
}

export interface RouteProvider {
  readonly name: string;
  computeRoutes(input: RouteRequestInput): Promise<RouteCandidate[]>;
}

/**
 * Travel-time/distance matrix across many origins and destinations.
 * Used when comparing which of several units should take a call.
 */
export interface RouteMatrixInput {
  origins: LatLng[];
  destinations: LatLng[];
  emergency?: boolean;
}

export interface RouteMatrixCell {
  originIndex: number;
  destinationIndex: number;
  distanceM: number;
  etaSeconds: number;
  reachable: boolean;
}

export interface RouteMatrixProvider {
  readonly name: string;
  computeMatrix(input: RouteMatrixInput): Promise<RouteMatrixCell[]>;
}
