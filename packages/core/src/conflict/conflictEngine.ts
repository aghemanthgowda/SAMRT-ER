import type { Conflict, Corridor, JunctionAllocation, Route } from '../types/domain.js';
import { ConflictStatus } from '../types/enums.js';
import { nextId } from '../util/id.js';
import { isoNow, secondsBetween } from '../util/time.js';

/**
 * Detection of shared-junction contention between active emergency corridors.
 *
 * A conflict is *not* simply "two routes contain the same junction". Two
 * ambulances thirty minutes apart share junctions all day without interfering.
 * A conflict exists only when both vehicles need the same junction inside one
 * clearance window — that is what the headway test below measures.
 */

export interface PlannedArrival {
  vehicleId: string;
  corridorId?: string;
  routeId: string;
  junctionId: string;
  /** When the vehicle is expected to enter the junction. */
  arrivalAt: string;
  /** Approach it enters on — needed by the safety validator. */
  approachId: string;
  priority: number;
  /** Seconds the junction must stay green for this vehicle. */
  occupancySeconds: number;
}

export interface ConflictDetectionOptions {
  /**
   * Minimum separation between two emergency movements through one junction.
   * Below this the junction cannot serve both without an unsafe overlap.
   * Defaults to the junction's own clearance time when supplied per-junction.
   */
  defaultClearanceSeconds?: number;
  clearanceByJunctionId?: ReadonlyMap<string, number>;
}

/**
 * Compare planned arrivals and report every genuine contention.
 *
 * `headwaySeconds` is the gap between the first vehicle clearing the junction
 * and the second arriving. Negative means their windows overlap.
 */
export function detectConflicts(
  arrivals: readonly PlannedArrival[],
  options: ConflictDetectionOptions = {},
): Conflict[] {
  const byJunction = new Map<string, PlannedArrival[]>();
  for (const arrival of arrivals) {
    const list = byJunction.get(arrival.junctionId) ?? [];
    list.push(arrival);
    byJunction.set(arrival.junctionId, list);
  }

  const conflicts: Conflict[] = [];
  const now = isoNow();

  for (const [junctionId, list] of byJunction) {
    if (list.length < 2) continue;
    const clearance =
      options.clearanceByJunctionId?.get(junctionId) ?? options.defaultClearanceSeconds ?? 6;

    const ordered = [...list].sort(
      (a, b) => new Date(a.arrivalAt).getTime() - new Date(b.arrivalAt).getTime(),
    );

    for (let i = 0; i < ordered.length - 1; i += 1) {
      const first = ordered[i]!;
      for (let j = i + 1; j < ordered.length; j += 1) {
        const second = ordered[j]!;
        if (first.vehicleId === second.vehicleId) continue;

        const gap = secondsBetween(first.arrivalAt, second.arrivalAt);
        const headway = gap - first.occupancySeconds - clearance;
        if (headway >= 0) continue;

        conflicts.push({
          id: nextId('CFL'),
          junctionId,
          primaryVehicleId: first.vehicleId,
          secondaryVehicleId: second.vehicleId,
          primaryEta: first.arrivalAt,
          secondaryEta: second.arrivalAt,
          headwaySeconds: Math.round(headway),
          status: ConflictStatus.DETECTED,
          explanation:
            `${first.vehicleId} and ${second.vehicleId} both need ${junctionId} within ` +
            `${Math.round(Math.abs(gap))} s. ${first.vehicleId} occupies it for ${first.occupancySeconds} s ` +
            `and the junction needs ${clearance} s of clearance, leaving a ${Math.round(headway)} s shortfall.`,
          detectedAt: now,
        });
      }
    }
  }

  return conflicts;
}

/** Junctions shared by two routes, ignoring timing. Used for a quick pre-check. */
export function sharedJunctions(a: Pick<Route, 'junctionIds'>, b: Pick<Route, 'junctionIds'>): string[] {
  const setB = new Set(b.junctionIds);
  return a.junctionIds.filter((id) => setB.has(id));
}

/** All junctions currently reserved by active corridors, with owning priority. */
export function activeReservations(
  corridors: readonly Corridor[],
  priorityByVehicleId: ReadonlyMap<string, number>,
): { junctionId: string; vehicleId: string; priority: number }[] {
  const out: { junctionId: string; vehicleId: string; priority: number }[] = [];
  for (const corridor of corridors) {
    for (const allocation of corridor.allocations) {
      if (allocation.releasedAt) continue;
      out.push({
        junctionId: allocation.junctionId,
        vehicleId: corridor.vehicleId,
        priority: priorityByVehicleId.get(corridor.vehicleId) ?? allocation.priority,
      });
    }
  }
  return out;
}

/** Reservation windows a new allocation must not overlap. */
export function occupiedWindows(
  corridors: readonly Corridor[],
  junctionId: string,
): Pick<JunctionAllocation, 'startsAt' | 'endsAt' | 'vehicleId' | 'priority'>[] {
  const windows: Pick<JunctionAllocation, 'startsAt' | 'endsAt' | 'vehicleId' | 'priority'>[] = [];
  for (const corridor of corridors) {
    for (const allocation of corridor.allocations) {
      if (allocation.junctionId !== junctionId || allocation.releasedAt) continue;
      windows.push({
        startsAt: allocation.startsAt,
        endsAt: allocation.endsAt,
        vehicleId: allocation.vehicleId,
        priority: allocation.priority,
      });
    }
  }
  return windows.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}
