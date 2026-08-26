import { describe, expect, it } from 'vitest';
import { testJunctions } from '../testing/fixtures.js';
import type { Corridor, JunctionAllocation } from '../types/domain.js';
import { CorridorStatus, ImpactLevel, JunctionState } from '../types/enums.js';
import { isoAdd, isoNow } from '../util/time.js';
import { computePublicImpact, impactLevel, projectedImpactScore } from './trafficImpact.js';

const junctions = testJunctions();

function corridor(states: { junctionId: string; state: JunctionState }[]): Corridor {
  const now = isoNow();
  const allocations: JunctionAllocation[] = states.map((entry, index) => ({
    id: `ALC-${index}`,
    junctionId: entry.junctionId,
    corridorId: 'COR-1',
    vehicleId: 'AMB-01',
    approachId: `${entry.junctionId}-N`,
    priority: 120,
    startsAt: now,
    endsAt: isoAdd(now, 20),
    state: entry.state,
    timeSlotted: false,
    ...(entry.state === JunctionState.RELEASED ? { releasedAt: now } : {}),
  }));

  return {
    id: 'COR-1',
    requestId: 'REQ-1',
    vehicleId: 'AMB-01',
    routeId: 'RTE-1',
    status: CorridorStatus.ACTIVE,
    junctionIds: states.map((entry) => entry.junctionId),
    allocations,
    preparingJunctionIds: [],
    releasedJunctionIds: [],
    createdAt: now,
  };
}

describe('public traffic impact', () => {
  it('reports no impact when nothing is held', () => {
    const impact = computePublicImpact({ junctions, corridors: [] });
    expect(impact.activeEmergencyJunctions).toBe(0);
    expect(impact.level).toBe(ImpactLevel.NONE);
    expect(impact.totalVehicleSecondsLost).toBe(0);
    expect(impact.totalJunctions).toBe(junctions.length);
  });

  it('counts only junctions that are actually held', () => {
    const impact = computePublicImpact({
      junctions,
      corridors: [
        corridor([
          { junctionId: 'J1', state: JunctionState.RELEASED },
          { junctionId: 'J2', state: JunctionState.GREEN },
          { junctionId: 'J3', state: JunctionState.PREPARING },
          { junctionId: 'J5', state: JunctionState.NORMAL },
        ]),
      ],
    });

    expect(impact.activeEmergencyJunctions).toBe(2);
    expect(impact.affectedJunctionIds.sort()).toEqual(['J2', 'J3']);
    expect(impact.totalVehicleSecondsLost).toBeGreaterThan(0);
    expect(impact.estimatedAdditionalDelaySeconds).toBeGreaterThan(0);
  });

  it('shows the rolling corridor costing less than a whole-route green', () => {
    const allJunctions = ['J1', 'J2', 'J3', 'J5', 'J7'];
    const wholeRoute = computePublicImpact({
      junctions,
      corridors: [corridor(allJunctions.map((junctionId) => ({ junctionId, state: JunctionState.GREEN })))],
    });
    const rolling = computePublicImpact({
      junctions,
      corridors: [
        corridor([
          { junctionId: 'J1', state: JunctionState.RELEASED },
          { junctionId: 'J2', state: JunctionState.GREEN },
          { junctionId: 'J3', state: JunctionState.PREPARING },
          { junctionId: 'J5', state: JunctionState.NORMAL },
          { junctionId: 'J7', state: JunctionState.NORMAL },
        ]),
      ],
    });

    expect(rolling.activeEmergencyJunctions).toBeLessThan(wholeRoute.activeEmergencyJunctions);
    expect(rolling.totalVehicleSecondsLost).toBeLessThan(wholeRoute.totalVehicleSecondsLost);
  });

  it('grades impact level by share of the network and delay', () => {
    expect(impactLevel(0, 12, 0)).toBe(ImpactLevel.NONE);
    expect(impactLevel(1, 12, 8)).toBe(ImpactLevel.LOW);
    expect(impactLevel(3, 12, 25)).toBe(ImpactLevel.MODERATE);
    expect(impactLevel(6, 12, 60)).toBe(ImpactLevel.HIGH);
  });

  it('projects a higher cost for busier junctions', () => {
    const busy = projectedImpactScore(['J2'], junctions);
    const quiet = projectedImpactScore(['J6'], junctions);
    expect(busy).toBeGreaterThan(quiet);
    expect(projectedImpactScore([], junctions)).toBe(0);
  });
});
