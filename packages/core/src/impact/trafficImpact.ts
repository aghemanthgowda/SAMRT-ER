import type { Corridor, Junction, PublicTrafficImpact } from '../types/domain.js';
import { ImpactLevel, JunctionState } from '../types/enums.js';

/**
 * Public traffic impact.
 *
 * A green corridor is not free — every second a junction is held for an
 * emergency vehicle is a second of delay imposed on everyone else. Making that
 * cost visible is what stops the system from over-reserving, and it is the
 * number that justifies the rolling window over a whole-route green.
 *
 * The model is a standard uniform-arrival delay approximation: with arrivals at
 * a constant rate over a red of length r, the average wait of a stopped vehicle
 * is r/2, and the number stopped is (arrival rate × r).
 */

export interface ImpactInput {
  junctions: readonly Junction[];
  corridors: readonly Corridor[];
  /** Seconds a cross-street is held for a single emergency crossing. */
  averageHoldSeconds?: number;
}

export function computePublicImpact(input: ImpactInput): PublicTrafficImpact {
  const holdSeconds = input.averageHoldSeconds ?? 14;
  const junctionById = new Map(input.junctions.map((junction) => [junction.id, junction]));

  const affected = new Set<string>();
  let totalVehicleSecondsLost = 0;

  for (const corridor of input.corridors) {
    for (const allocation of corridor.allocations) {
      const holding =
        allocation.state === JunctionState.GREEN || allocation.state === JunctionState.PREPARING;
      if (!holding || allocation.releasedAt) continue;

      affected.add(allocation.junctionId);
      const junction = junctionById.get(allocation.junctionId);
      if (!junction) continue;

      // Only the cross-street traffic is delayed; the emergency movement's own
      // approach is being served, not stopped.
      const crossStreetShare = crossStreetFraction(junction, allocation.approachId);
      const arrivalsPerSecond = (junction.averageThroughputVph * crossStreetShare) / 3600;
      const stoppedVehicles = arrivalsPerSecond * holdSeconds;
      // Average wait is half the hold for a uniformly arriving queue.
      totalVehicleSecondsLost += stoppedVehicles * (holdSeconds / 2);
    }
  }

  const affectedJunctionIds = [...affected];
  const totalStopped = affectedJunctionIds.reduce((total, id) => {
    const junction = junctionById.get(id);
    if (!junction) return total;
    return total + (junction.averageThroughputVph / 3600) * holdSeconds * 0.5;
  }, 0);

  const estimatedAdditionalDelaySeconds =
    totalStopped > 0 ? Math.round(totalVehicleSecondsLost / totalStopped) : 0;

  return {
    activeEmergencyJunctions: affectedJunctionIds.length,
    totalJunctions: input.junctions.length,
    estimatedAdditionalDelaySeconds,
    totalVehicleSecondsLost: Math.round(totalVehicleSecondsLost),
    level: impactLevel(affectedJunctionIds.length, input.junctions.length, estimatedAdditionalDelaySeconds),
    affectedJunctionIds,
  };
}

/**
 * Share of a junction's throughput that is stopped when one approach is held.
 * Falls back to a two-phase assumption when conflict data is missing.
 */
function crossStreetFraction(junction: Junction, servedApproachId: string): number {
  const served = junction.approaches.find((approach) => approach.id === servedApproachId);
  if (!served || junction.approaches.length <= 1) return 0.5;
  const conflicting = served.conflictsWith.length;
  return Math.min(0.85, Math.max(0.15, conflicting / junction.approaches.length));
}

export function impactLevel(
  activeJunctions: number,
  totalJunctions: number,
  delaySeconds: number,
): ImpactLevel {
  if (activeJunctions === 0) return ImpactLevel.NONE;
  const share = totalJunctions > 0 ? activeJunctions / totalJunctions : 0;
  if (share > 0.35 || delaySeconds > 45) return ImpactLevel.HIGH;
  if (share > 0.18 || delaySeconds > 22) return ImpactLevel.MODERATE;
  return ImpactLevel.LOW;
}

/**
 * Estimated public cost of granting a corridor over a set of junctions, in
 * vehicle-seconds. Used by the cost model to prefer routes through quieter
 * junctions when the ETA difference is negligible.
 */
export function projectedImpactScore(
  junctionIds: readonly string[],
  junctions: readonly Junction[],
  holdSeconds = 14,
): number {
  const byId = new Map(junctions.map((junction) => [junction.id, junction]));
  return Math.round(
    junctionIds.reduce((total, id) => {
      const junction = byId.get(id);
      if (!junction) return total;
      const stopped = (junction.averageThroughputVph / 3600) * holdSeconds * 0.5;
      return total + stopped * (holdSeconds / 2);
    }, 0),
  );
}
