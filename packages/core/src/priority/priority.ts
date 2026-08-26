import type { EmergencyRequest, VehicleState } from '../types/domain.js';
import { Severity, VehicleKind, VehicleStatus } from '../types/enums.js';

/**
 * Priority scoring.
 *
 * Conflicts between emergency vehicles are settled on a numeric score rather
 * than on vehicle type alone: a CRITICAL ambulance outranks a MEDIUM fire
 * appliance, but a CRITICAL fire call outranks a MEDIUM patient transfer. The
 * score is deliberately coarse-grained and explainable — a controller has to be
 * able to justify the decision afterwards.
 */

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  [Severity.CRITICAL]: 100,
  [Severity.HIGH]: 70,
  [Severity.MEDIUM]: 45,
  [Severity.LOW]: 20,
};

/**
 * Baseline weight by vehicle type, applied on top of severity.
 * Fire appliances carry a small premium because a fire escalates with time in
 * a way that most transfers do not.
 */
export const VEHICLE_KIND_WEIGHT: Record<VehicleKind, number> = {
  [VehicleKind.AMBULANCE]: 12,
  [VehicleKind.FIRE_TRUCK]: 14,
  [VehicleKind.POLICE_UNIT]: 8,
};

export interface PriorityInput {
  severity: Severity;
  vehicleKind: VehicleKind;
  /** Seconds since the request was submitted — ageing prevents starvation. */
  waitingSeconds?: number;
  /** Seconds remaining to destination; closer vehicles finish sooner. */
  etaSeconds?: number;
  /** A vehicle already holding a corridor keeps a small incumbency bonus. */
  hasActiveCorridor?: boolean;
}

/**
 * Compute a comparable priority score. Higher wins.
 *
 * Components:
 *   severity      dominant term
 *   vehicle kind  small type premium
 *   ageing        +1 per 10 s waiting, capped, so a queued unit eventually wins
 *   proximity     up to +8 for a vehicle about to arrive — finishing it frees
 *                 the network sooner than holding it behind a slower unit
 *   incumbency    +5 to avoid thrashing an already-active corridor
 */
export function priorityScore(input: PriorityInput): number {
  const severity = SEVERITY_WEIGHT[input.severity];
  const kind = VEHICLE_KIND_WEIGHT[input.vehicleKind];
  const ageing = Math.min(25, Math.floor((input.waitingSeconds ?? 0) / 10));
  const proximity =
    input.etaSeconds === undefined ? 0 : Math.max(0, Math.min(8, Math.round(8 - input.etaSeconds / 60)));
  const incumbency = input.hasActiveCorridor ? 5 : 0;
  return severity + kind + ageing + proximity + incumbency;
}

export function priorityForRequest(
  request: Pick<EmergencyRequest, 'severity' | 'createdAt'>,
  vehicleKind: VehicleKind,
  state?: Pick<VehicleState, 'etaSeconds' | 'corridorId' | 'status'>,
  now: number = Date.now(),
): number {
  return priorityScore({
    severity: request.severity,
    vehicleKind,
    waitingSeconds: Math.max(0, (now - new Date(request.createdAt).getTime()) / 1000),
    etaSeconds: state?.etaSeconds,
    hasActiveCorridor: Boolean(state?.corridorId) && state?.status === VehicleStatus.ACTIVE,
  });
}

/** Plain-language justification of a priority comparison, for the conflict panel. */
export function explainPriority(
  a: { label: string; score: number; severity: Severity },
  b: { label: string; score: number; severity: Severity },
): string {
  if (a.score === b.score) {
    return `${a.label} and ${b.label} score equally (${a.score}); the earlier arrival is served first.`;
  }
  const [winner, loser] = a.score > b.score ? [a, b] : [b, a];
  const margin = Math.abs(a.score - b.score);
  const severityNote =
    winner.severity === loser.severity
      ? 'same severity, decided on proximity and waiting time'
      : `${winner.severity} outranks ${loser.severity}`;
  return `${winner.label} takes precedence over ${loser.label} by ${margin} points (${severityNote}).`;
}
