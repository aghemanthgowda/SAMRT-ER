import type { RouteCandidate } from '../types/domain.js';

/**
 * Weights of the composite route cost.
 *
 * The brief is explicit: optimise minimum emergency response time subject to
 * safety, traffic, junction availability and public impact — never shortest
 * distance. So ETA is the dominant term and distance does not appear at all;
 * it only shows up indirectly through travel time.
 */
export interface CostWeights {
  /** Seconds of ETA — weight 1.0 makes every other term ETA-equivalent. */
  eta: number;
  /** Seconds of penalty per junction already reserved by a higher priority. */
  conflictPenaltySeconds: number;
  /** Seconds of penalty per unit of public-impact score. */
  publicImpactWeight: number;
  /** Seconds of penalty per junction on the route (corridor setup cost). */
  junctionCountPenaltySeconds: number;
  /** Seconds of penalty applied to a soft-avoided junction. */
  softAvoidPenaltySeconds: number;
}

export const DEFAULT_COST_WEIGHTS: CostWeights = {
  eta: 1,
  conflictPenaltySeconds: 45,
  publicImpactWeight: 0.06,
  junctionCountPenaltySeconds: 2.5,
  softAvoidPenaltySeconds: 25,
};

export interface CostContext {
  /** Junctions the caller would rather not use, but may. */
  softAvoidJunctionIds?: ReadonlySet<string>;
  weights?: Partial<CostWeights>;
}

/**
 * Composite cost of a candidate, expressed entirely in ETA-equivalent seconds
 * so the trade-offs are legible: "this route costs 45 s more because it fights
 * a higher-priority corridor at J2".
 */
export function scoreCandidate(candidate: RouteCandidate, context: CostContext = {}): number {
  const weights = { ...DEFAULT_COST_WEIGHTS, ...context.weights };
  if (!Number.isFinite(candidate.etaSeconds)) return Number.POSITIVE_INFINITY;

  const softAvoid = context.softAvoidJunctionIds ?? new Set<string>();
  const softAvoidHits = candidate.junctionIds.filter((id) => softAvoid.has(id)).length;

  return (
    candidate.etaSeconds * weights.eta +
    candidate.conflictingJunctionIds.length * weights.conflictPenaltySeconds +
    candidate.publicImpactScore * weights.publicImpactWeight +
    candidate.junctionIds.length * weights.junctionCountPenaltySeconds +
    softAvoidHits * weights.softAvoidPenaltySeconds
  );
}

/** Rank candidates cheapest-first, leaving the input untouched. */
export function rankCandidates(candidates: readonly RouteCandidate[], context: CostContext = {}): RouteCandidate[] {
  return candidates
    .map((candidate) => ({ ...candidate, cost: scoreCandidate(candidate, context) }))
    .sort((a, b) => a.cost - b.cost);
}
