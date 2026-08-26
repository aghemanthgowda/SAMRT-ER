import type { Junction, JunctionAllocation, SignalCommand } from '../types/domain.js';
import { SignalAspect } from '../types/enums.js';
import { secondsBetween } from '../util/time.js';

/**
 * Safety validator.
 *
 * Last gate before any signal command leaves SMART-ER:
 *
 *   route → conflict → corridor → SAFETY VALIDATOR → signal → junction
 *
 * Nothing downstream re-checks these rules, and in Phase 2 the thing downstream
 * is a real traffic light on a real road. Every rejection here is a movement
 * that would have been physically unsafe, so the validator is deliberately
 * conservative: it fails closed, and an unknown junction or approach is a
 * rejection rather than a pass.
 */

export interface SafetyContext {
  junction: Junction;
  /** Allocations currently live at this junction, including the one under test. */
  activeAllocations: readonly JunctionAllocation[];
  /** Aspect the junction is displaying right now, per approach. */
  currentAspects: ReadonlyMap<string, SignalAspect>;
  /** When the last aspect change was applied, per approach. */
  lastChangeAt: ReadonlyMap<string, string>;
  /** True when the junction controller has not acknowledged recently. */
  deviceOffline: boolean;
  now?: string;
}

export interface SafetyVerdict {
  approved: boolean;
  notes: string[];
  /** Populated when the command must be preceded by an all-red interval. */
  requiredClearanceSeconds?: number;
}

/** Minimum green once shown, so a signal never flickers between aspects. */
export const MIN_GREEN_SECONDS = 4;
/** Minimum amber between green and red. */
export const MIN_AMBER_SECONDS = 3;

export function validateSignalCommand(command: SignalCommand, context: SafetyContext): SafetyVerdict {
  const notes: string[] = [];
  const now = context.now ?? new Date().toISOString();
  const { junction } = context;

  // -- 1. the junction must be the one addressed --------------------------
  if (junction.id !== command.junctionId) {
    return { approved: false, notes: [`Command addresses ${command.junctionId} but junction is ${junction.id}.`] };
  }

  // -- 2. the approach must exist -----------------------------------------
  const approach = junction.approaches.find((entry) => entry.id === command.approachId);
  if (!approach) {
    return {
      approved: false,
      notes: [`Approach ${command.approachId} is not registered at ${junction.code}. Command rejected.`],
    };
  }

  // -- 3. an unreachable controller may not be commanded green ------------
  if (context.deviceOffline && command.aspect === SignalAspect.GREEN) {
    return {
      approved: false,
      notes: [
        `Junction controller for ${junction.code} is offline. A green cannot be confirmed, ` +
          `so the corridor must route around it rather than assume it.`,
      ],
    };
  }

  // -- 4. no conflicting green may already be displayed -------------------
  if (command.aspect === SignalAspect.GREEN) {
    for (const conflictingId of approach.conflictsWith) {
      const aspect = context.currentAspects.get(conflictingId);
      if (aspect === SignalAspect.GREEN || aspect === SignalAspect.AMBER) {
        const changedAt = context.lastChangeAt.get(conflictingId);
        const elapsed = changedAt ? secondsBetween(changedAt, now) : 0;
        const required = junction.clearanceSeconds + (aspect === SignalAspect.GREEN ? MIN_AMBER_SECONDS : 0);
        if (elapsed < required) {
          return {
            approved: false,
            notes: [
              `Conflicting approach ${conflictingId} at ${junction.code} is still ${aspect}. ` +
                `${Math.max(0, Math.ceil(required - elapsed))} s of clearance remain before ` +
                `${command.approachId} may be given green.`,
            ],
            requiredClearanceSeconds: Math.max(0, Math.ceil(required - elapsed)),
          };
        }
        notes.push(`Conflicting approach ${conflictingId} cleared ${Math.round(elapsed)} s ago.`);
      }
    }
  }

  // -- 5. two emergency vehicles may not hold the same junction at once ---
  if (command.aspect === SignalAspect.GREEN) {
    const overlapping = context.activeAllocations.filter(
      (allocation) =>
        allocation.junctionId === junction.id &&
        !allocation.releasedAt &&
        allocation.vehicleId !== command.vehicleId &&
        allocation.approachId !== command.approachId &&
        windowsOverlap(allocation, now, command.holdSeconds),
    );
    if (overlapping.length > 0) {
      const other = overlapping[0]!;
      return {
        approved: false,
        notes: [
          `${junction.code} is already reserved for ${other.vehicleId} on approach ${other.approachId} ` +
            `until ${other.endsAt}. Overlapping emergency greens are never issued — ` +
            `the corridor engine must time-slot or reroute first.`,
        ],
      };
    }
  }

  // -- 6. minimum green before it may be taken away -----------------------
  if (command.aspect === SignalAspect.RED || command.aspect === SignalAspect.ALL_RED) {
    const current = context.currentAspects.get(command.approachId);
    if (current === SignalAspect.GREEN) {
      const changedAt = context.lastChangeAt.get(command.approachId);
      const elapsed = changedAt ? secondsBetween(changedAt, now) : MIN_GREEN_SECONDS;
      if (elapsed < MIN_GREEN_SECONDS) {
        return {
          approved: false,
          notes: [
            `${command.approachId} has been green for only ${Math.round(elapsed)} s. ` +
              `Minimum green is ${MIN_GREEN_SECONDS} s before an aspect change is safe.`,
          ],
        };
      }
      notes.push(`Green held ${Math.round(elapsed)} s; amber must precede red.`);
      return {
        approved: true,
        notes,
        requiredClearanceSeconds: MIN_AMBER_SECONDS,
      };
    }
  }

  // -- 7. hold duration sanity -------------------------------------------
  if (command.holdSeconds < 0 || command.holdSeconds > 180) {
    return {
      approved: false,
      notes: [`Hold of ${command.holdSeconds} s is outside the permitted 0–180 s range.`],
    };
  }

  notes.push(`${command.aspect} on ${command.approachId} at ${junction.code} is safe to issue.`);
  return { approved: true, notes };
}

function windowsOverlap(allocation: JunctionAllocation, from: string, holdSeconds: number): boolean {
  const start = new Date(from).getTime();
  const end = start + holdSeconds * 1000;
  const otherStart = new Date(allocation.startsAt).getTime();
  const otherEnd = new Date(allocation.endsAt).getTime();
  return start < otherEnd && otherStart < end;
}

/**
 * Fail-safe aspect for a junction whose controller has gone silent.
 * Flashing red is the standard degraded mode: treat as an all-way stop.
 */
export function failSafeAspect(): SignalAspect {
  return SignalAspect.FLASHING_RED;
}

/**
 * Validate a whole batch, keeping only the commands that pass.
 * Rejections are returned rather than thrown — the caller logs them to the
 * incident timeline so a controller can see what the system declined to do.
 */
export function validateBatch(
  commands: readonly SignalCommand[],
  contextFor: (command: SignalCommand) => SafetyContext,
): { approved: SignalCommand[]; rejected: { command: SignalCommand; verdict: SafetyVerdict }[] } {
  const approved: SignalCommand[] = [];
  const rejected: { command: SignalCommand; verdict: SafetyVerdict }[] = [];

  for (const command of commands) {
    const verdict = validateSignalCommand(command, contextFor(command));
    if (verdict.approved) {
      approved.push({ ...command, safetyApproved: true, safetyNotes: verdict.notes });
    } else {
      rejected.push({ command: { ...command, safetyApproved: false, safetyNotes: verdict.notes }, verdict });
    }
  }
  return { approved, rejected };
}
