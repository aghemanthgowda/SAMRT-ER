import type { Conflict, RouteCandidate } from '../types/domain.js';
import { ConflictStatus, ResolutionStrategy } from '../types/enums.js';
import { formatEta } from '../util/time.js';

/**
 * Conflict resolution.
 *
 * The brief is explicit about the order of preference, and the reason matters:
 * blocking a fire appliance until an ambulance has finished is the *worst*
 * outcome for total response time, so it is the last resort, not the first.
 *
 *   1. Reroute the lower-priority vehicle onto a conflict-free alternative,
 *      if that alternative is faster or only marginally slower.
 *   2. Otherwise time-slot the single contended junction — both vehicles keep
 *      their route, and only that junction is coordinated.
 *   3. Only if neither works, hold the lower-priority vehicle.
 */

export interface ResolutionInput {
  conflict: Conflict;
  /** Vehicle that will keep its route. */
  primary: { vehicleId: string; priority: number; etaSeconds: number; label: string };
  /** Vehicle that may be rerouted or slotted. */
  secondary: { vehicleId: string; priority: number; etaSeconds: number; label: string };
  /** Conflict-free candidates already computed for the secondary vehicle. */
  secondaryAlternatives: readonly RouteCandidate[];
  /** Clearance the junction needs between the two movements. */
  clearanceSeconds: number;
  /** Seconds the primary vehicle occupies the junction. */
  primaryOccupancySeconds: number;
  /**
   * How much extra ETA a reroute may cost and still be preferred over
   * time-slotting. Defaults to 40 s: below this, keeping the junction free for
   * public traffic and avoiding a coordinated hold is worth the detour.
   */
  rerouteToleranceSeconds?: number;
  /**
   * Maximum a vehicle may be held at a junction before holding is unacceptable.
   * Above this the conflict is reported unresolved for controller attention.
   */
  maxHoldSeconds?: number;
}

export interface ResolutionOutcome {
  strategy: ResolutionStrategy;
  conflict: Conflict;
  /** Set when the outcome is REROUTE — the route the secondary should adopt. */
  newRoute?: RouteCandidate;
  /** Set when the outcome is TIME_SLOT — the delayed vehicle's window offset. */
  slotDelaySeconds?: number;
  /** Set when the outcome is PRIORITY_HOLD. */
  holdSeconds?: number;
  explanation: string;
}

export function resolveConflict(input: ResolutionInput): ResolutionOutcome {
  const {
    conflict,
    primary,
    secondary,
    secondaryAlternatives,
    clearanceSeconds,
    primaryOccupancySeconds,
  } = input;
  const tolerance = input.rerouteToleranceSeconds ?? 40;
  const maxHold = input.maxHoldSeconds ?? 90;

  // Seconds the secondary must wait to restore a safe headway. `headwaySeconds`
  // is already `gap - occupancy - clearance`, so a negative value is exactly the
  // shortfall that has to be absorbed.
  const requiredDelay = Math.max(0, -conflict.headwaySeconds);

  // --- 1. conflict-free reroute -------------------------------------------
  const conflictFree = secondaryAlternatives
    .filter((candidate) => !candidate.junctionIds.includes(conflict.junctionId))
    .filter((candidate) => candidate.conflictingJunctionIds.length === 0)
    .sort((a, b) => a.etaSeconds - b.etaSeconds);

  const best = conflictFree[0];
  if (best) {
    const delta = best.etaSeconds - secondary.etaSeconds;
    // Preferred when faster, or slower by less than the time it would otherwise wait.
    const worthIt = delta <= 0 || delta < Math.max(tolerance, requiredDelay);
    if (worthIt) {
      const timeSaved = Math.round(secondary.etaSeconds + requiredDelay - best.etaSeconds);
      return {
        strategy: ResolutionStrategy.REROUTE,
        newRoute: best,
        conflict: {
          ...conflict,
          status: ConflictStatus.RESOLVED_REROUTE,
          strategy: ResolutionStrategy.REROUTE,
          reroutedVehicleId: secondary.vehicleId,
          originalEtaSeconds: secondary.etaSeconds,
          newEtaSeconds: best.etaSeconds,
          timeSavedSeconds: timeSaved,
          resolvedAt: new Date().toISOString(),
          explanation: rerouteExplanation(conflict, primary, secondary, best, requiredDelay, timeSaved),
        },
        explanation: rerouteExplanation(conflict, primary, secondary, best, requiredDelay, timeSaved),
      };
    }
  }

  // --- 2. time-slot the single contended junction --------------------------
  const slotDelay = Math.ceil(requiredDelay);
  if (slotDelay <= maxHold) {
    const explanation = timeSlotExplanation(
      conflict,
      primary,
      secondary,
      slotDelay,
      clearanceSeconds,
      primaryOccupancySeconds,
    );
    return {
      strategy: ResolutionStrategy.TIME_SLOT,
      slotDelaySeconds: slotDelay,
      conflict: {
        ...conflict,
        status: ConflictStatus.RESOLVED_TIME_SLOT,
        strategy: ResolutionStrategy.TIME_SLOT,
        originalEtaSeconds: secondary.etaSeconds,
        newEtaSeconds: secondary.etaSeconds + slotDelay,
        timeSavedSeconds: 0,
        resolvedAt: new Date().toISOString(),
        explanation,
      },
      explanation,
    };
  }

  // --- 3. priority hold ----------------------------------------------------
  const explanation =
    `No conflict-free alternative exists for ${secondary.label} and time-slotting ${conflict.junctionId} ` +
    `would delay it by ${Math.ceil(requiredDelay)} s, beyond the ${maxHold} s limit. ` +
    `${secondary.label} is held until ${primary.label} clears the junction. Controller review required.`;

  return {
    strategy: ResolutionStrategy.PRIORITY_HOLD,
    holdSeconds: Math.ceil(requiredDelay),
    conflict: {
      ...conflict,
      status: ConflictStatus.RESOLVED_PRIORITY_HOLD,
      strategy: ResolutionStrategy.PRIORITY_HOLD,
      originalEtaSeconds: secondary.etaSeconds,
      newEtaSeconds: secondary.etaSeconds + Math.ceil(requiredDelay),
      resolvedAt: new Date().toISOString(),
      explanation,
    },
    explanation,
  };
}

function rerouteExplanation(
  conflict: Conflict,
  primary: { label: string },
  secondary: { label: string; etaSeconds: number },
  route: RouteCandidate,
  requiredDelay: number,
  timeSaved: number,
): string {
  const via = route.junctionIds.join(' → ');
  return [
    `${conflict.junctionId} conflict: ${primary.label} and ${secondary.label} arrive ` +
      `${Math.abs(conflict.headwaySeconds)} s too close together.`,
    `Holding ${secondary.label} would cost it ${requiredDelay} s.`,
    `A conflict-free alternative exists via ${via}.`,
    `${secondary.label} rerouted. Original ETA ${formatEta(secondary.etaSeconds)}, ` +
      `new ETA ${formatEta(route.etaSeconds)} — ${timeSaved >= 0 ? 'saving' : 'costing'} ` +
      `${Math.abs(timeSaved)} s against waiting.`,
    `Decision: conflict-free alternative selected.`,
  ].join(' ');
}

function timeSlotExplanation(
  conflict: Conflict,
  primary: { label: string },
  secondary: { label: string },
  slotDelay: number,
  clearanceSeconds: number,
  primaryOccupancySeconds: number,
): string {
  return [
    `${conflict.junctionId} conflict: ${primary.label} and ${secondary.label} contend for the same junction.`,
    `No alternative route improves on waiting, so only ${conflict.junctionId} is coordinated —`,
    `${primary.label} holds it green for ${primaryOccupancySeconds} s, then ${secondary.label} takes the next window,`,
    `separated by ${clearanceSeconds} s of clearance.`,
    `${secondary.label} is delayed by ${slotDelay} s and keeps its original route.`,
    `Decision: junction time-slotted.`,
  ].join(' ');
}

/** Order two contending vehicles: higher priority first, earlier arrival breaks ties. */
export function orderContenders<T extends { priority: number; arrivalAt: string; vehicleId: string }>(
  a: T,
  b: T,
): [T, T] {
  if (a.priority !== b.priority) return a.priority > b.priority ? [a, b] : [b, a];
  const at = new Date(a.arrivalAt).getTime();
  const bt = new Date(b.arrivalAt).getTime();
  if (at !== bt) return at < bt ? [a, b] : [b, a];
  return a.vehicleId <= b.vehicleId ? [a, b] : [b, a];
}
