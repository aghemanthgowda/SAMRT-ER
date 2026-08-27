import { beforeEach, describe, expect, it } from 'vitest';
import { RoadGraph } from '../graph/roadGraph.js';
import { GraphRouteProvider } from '../routing/GraphRouteProvider.js';
import { testJunctions, testSegments } from '../testing/fixtures.js';
import { ConflictStatus, DestinationKind, ResolutionStrategy, Severity, VehicleKind } from '../types/enums.js';
import { priorityScore } from '../priority/priority.js';
import { resetIds } from '../util/id.js';
import { isoAdd, isoNow } from '../util/time.js';
import { approachConflictMatrix, detectConflicts, sharedJunctions, type PlannedArrival } from './conflictEngine.js';
import { orderContenders, resolveConflict } from './resolution.js';

function arrival(overrides: Partial<PlannedArrival> & Pick<PlannedArrival, 'vehicleId' | 'arrivalAt'>): PlannedArrival {
  return {
    routeId: `RTE-${overrides.vehicleId}`,
    junctionId: 'J2',
    approachId: 'J2-N',
    priority: 100,
    occupancySeconds: 8,
    ...overrides,
  };
}

describe('conflict detection', () => {
  beforeEach(() => resetIds());

  it('does not flag two vehicles that use a junction far apart in time', () => {
    const base = isoNow();
    const conflicts = detectConflicts(
      [
        arrival({ vehicleId: 'AMB-01', arrivalAt: base }),
        arrival({ vehicleId: 'FIRE-01', arrivalAt: isoAdd(base, 600) }),
      ],
      { defaultClearanceSeconds: 6 },
    );
    expect(conflicts).toHaveLength(0);
  });

  it('flags two vehicles that need the same junction inside the clearance window', () => {
    const base = isoNow();
    const conflicts = detectConflicts(
      [
        arrival({ vehicleId: 'AMB-01', arrivalAt: base }),
        arrival({ vehicleId: 'FIRE-01', arrivalAt: isoAdd(base, 5) }),
      ],
      { defaultClearanceSeconds: 6 },
    );

    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0]!;
    expect(conflict.junctionId).toBe('J2');
    expect(conflict.primaryVehicleId).toBe('AMB-01');
    expect(conflict.secondaryVehicleId).toBe('FIRE-01');
    // gap 5, occupancy 8, clearance 6 → headway = 5 - 8 - 6 = -9
    expect(conflict.headwaySeconds).toBe(-9);
    expect(conflict.status).toBe(ConflictStatus.DETECTED);
  });

  it('ignores different junctions entirely', () => {
    const base = isoNow();
    const conflicts = detectConflicts([
      arrival({ vehicleId: 'AMB-01', arrivalAt: base, junctionId: 'J2' }),
      arrival({ vehicleId: 'FIRE-01', arrivalAt: base, junctionId: 'J5' }),
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it('uses the junction-specific clearance when supplied', () => {
    const base = isoNow();
    const arrivals = [
      arrival({ vehicleId: 'AMB-01', arrivalAt: base, occupancySeconds: 4 }),
      arrival({ vehicleId: 'FIRE-01', arrivalAt: isoAdd(base, 12) }),
    ];

    expect(detectConflicts(arrivals, { defaultClearanceSeconds: 4 })).toHaveLength(0);
    expect(
      detectConflicts(arrivals, { clearanceByJunctionId: new Map([['J2', 20]]) }),
    ).toHaveLength(1);
  });

  it('does not flag opposing movements the junction can serve together', () => {
    const base = isoNow();
    // J2-N and J2-S are opposing approaches: in the fixture they conflict with
    // E and W, but not with each other, so both can be held green at once.
    const matrix = approachConflictMatrix(testJunctions());

    const arrivals = [
      arrival({ vehicleId: 'AMB-01', arrivalAt: base, approachId: 'J2-N' }),
      arrival({ vehicleId: 'FIRE-01', arrivalAt: isoAdd(base, 3), approachId: 'J2-S' }),
    ];

    // Without the matrix the timing alone looks like contention.
    expect(detectConflicts(arrivals, { defaultClearanceSeconds: 6 })).toHaveLength(1);
    // With it, the junction can serve both and there is nothing to resolve.
    expect(
      detectConflicts(arrivals, { defaultClearanceSeconds: 6, approachConflictsByJunction: matrix }),
    ).toHaveLength(0);
  });

  it('still flags crossing movements that cannot share the junction', () => {
    const base = isoNow();
    const matrix = approachConflictMatrix(testJunctions());

    const conflicts = detectConflicts(
      [
        arrival({ vehicleId: 'AMB-01', arrivalAt: base, approachId: 'J2-N' }),
        arrival({ vehicleId: 'POL-02', arrivalAt: isoAdd(base, 3), approachId: 'J2-E' }),
      ],
      { defaultClearanceSeconds: 6, approachConflictsByJunction: matrix },
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.junctionId).toBe('J2');
  });

  it('flags two vehicles on the same approach regardless of the matrix', () => {
    const base = isoNow();
    const matrix = approachConflictMatrix(testJunctions());

    // One approach cannot serve two emergency vehicles nose to tail either.
    const conflicts = detectConflicts(
      [
        arrival({ vehicleId: 'AMB-01', arrivalAt: base, approachId: 'J2-N' }),
        arrival({ vehicleId: 'AMB-02', arrivalAt: isoAdd(base, 3), approachId: 'J2-N' }),
      ],
      { defaultClearanceSeconds: 6, approachConflictsByJunction: matrix },
    );
    expect(conflicts).toHaveLength(1);
  });

  it('finds shared junctions between two routes', () => {
    const shared = sharedJunctions({ junctionIds: ['J1', 'J2', 'J3'] }, { junctionIds: ['J4', 'J2', 'J5'] });
    expect(shared).toEqual(['J2']);
  });
});

describe('conflict resolution', () => {
  beforeEach(() => resetIds());

  const graph = () => new RoadGraph(testJunctions(), testSegments());
  const FIRE_SITE = {
    id: 'INC-1',
    kind: DestinationKind.INCIDENT_SITE,
    name: 'Corporation Circle fire',
    position: { lat: 12.9673, lng: 77.5905 },
  };

  function fireAlternatives() {
    return new GraphRouteProvider(graph()).computeRoutesSync({
      origin: { lat: 12.9614, lng: 77.5966 },
      destination: FIRE_SITE,
      alternatives: 4,
      emergency: true,
    });
  }

  const conflict = {
    id: 'CFL-1',
    junctionId: 'J2',
    primaryVehicleId: 'AMB-01',
    secondaryVehicleId: 'FIRE-01',
    primaryEta: isoNow(),
    secondaryEta: isoAdd(isoNow(), 5),
    headwaySeconds: -9,
    status: ConflictStatus.DETECTED,
    explanation: '',
    detectedAt: isoNow(),
  };

  it('prefers a conflict-free reroute over blocking the second vehicle', () => {
    const alternatives = fireAlternatives().filter((route) => !route.junctionIds.includes('J2'));
    expect(alternatives.length).toBeGreaterThan(0);

    const outcome = resolveConflict({
      conflict,
      primary: { vehicleId: 'AMB-01', priority: 130, etaSeconds: 300, label: 'AMB-01' },
      secondary: { vehicleId: 'FIRE-01', priority: 110, etaSeconds: 340, label: 'FIRE-01' },
      secondaryAlternatives: alternatives,
      clearanceSeconds: 6,
      primaryOccupancySeconds: 8,
    });

    expect(outcome.strategy).toBe(ResolutionStrategy.REROUTE);
    expect(outcome.newRoute).toBeDefined();
    expect(outcome.newRoute!.junctionIds).not.toContain('J2');
    expect(outcome.conflict.status).toBe(ConflictStatus.RESOLVED_REROUTE);
    expect(outcome.conflict.reroutedVehicleId).toBe('FIRE-01');
    expect(outcome.explanation).toContain('conflict-free alternative selected');
  });

  it('time-slots the single contended junction when no alternative helps', () => {
    const outcome = resolveConflict({
      conflict,
      primary: { vehicleId: 'AMB-01', priority: 130, etaSeconds: 300, label: 'AMB-01' },
      secondary: { vehicleId: 'FIRE-01', priority: 110, etaSeconds: 340, label: 'FIRE-01' },
      secondaryAlternatives: [],
      clearanceSeconds: 6,
      primaryOccupancySeconds: 8,
    });

    expect(outcome.strategy).toBe(ResolutionStrategy.TIME_SLOT);
    expect(outcome.slotDelaySeconds).toBe(9);
    expect(outcome.conflict.status).toBe(ConflictStatus.RESOLVED_TIME_SLOT);
    expect(outcome.explanation).toContain('junction time-slotted');
    // Only the contended junction is coordinated — the route is unchanged.
    expect(outcome.newRoute).toBeUndefined();
  });

  it('does not reroute onto a much slower alternative', () => {
    const slowAlternative = {
      ...fireAlternatives()[0]!,
      id: 'RC-SLOW',
      junctionIds: ['J4', 'J6', 'J7', 'J5'],
      etaSeconds: 900,
      conflictingJunctionIds: [],
    };

    const outcome = resolveConflict({
      conflict,
      primary: { vehicleId: 'AMB-01', priority: 130, etaSeconds: 300, label: 'AMB-01' },
      secondary: { vehicleId: 'FIRE-01', priority: 110, etaSeconds: 340, label: 'FIRE-01' },
      secondaryAlternatives: [slowAlternative],
      clearanceSeconds: 6,
      primaryOccupancySeconds: 8,
    });

    // Waiting 9 s beats a 560 s detour.
    expect(outcome.strategy).toBe(ResolutionStrategy.TIME_SLOT);
  });

  it('falls back to a priority hold only when the delay is unacceptable', () => {
    const outcome = resolveConflict({
      conflict: { ...conflict, headwaySeconds: -240 },
      primary: { vehicleId: 'AMB-01', priority: 130, etaSeconds: 300, label: 'AMB-01' },
      secondary: { vehicleId: 'FIRE-01', priority: 110, etaSeconds: 340, label: 'FIRE-01' },
      secondaryAlternatives: [],
      clearanceSeconds: 6,
      primaryOccupancySeconds: 8,
      maxHoldSeconds: 90,
    });

    expect(outcome.strategy).toBe(ResolutionStrategy.PRIORITY_HOLD);
    expect(outcome.holdSeconds).toBe(240);
    expect(outcome.conflict.status).toBe(ConflictStatus.RESOLVED_PRIORITY_HOLD);
    expect(outcome.explanation).toContain('Controller review required');
  });

  it('orders contenders by priority, then by arrival time', () => {
    const base = isoNow();
    const high = { vehicleId: 'AMB-01', priority: 130, arrivalAt: isoAdd(base, 20) };
    const low = { vehicleId: 'FIRE-01', priority: 110, arrivalAt: base };
    expect(orderContenders(low, high)[0]).toBe(high);

    const earlier = { vehicleId: 'POL-01', priority: 110, arrivalAt: base };
    const later = { vehicleId: 'POL-02', priority: 110, arrivalAt: isoAdd(base, 30) };
    expect(orderContenders(later, earlier)[0]).toBe(earlier);
  });

  it('scores a critical ambulance above a medium fire call', () => {
    const criticalAmbulance = priorityScore({ severity: Severity.CRITICAL, vehicleKind: VehicleKind.AMBULANCE });
    const mediumFire = priorityScore({ severity: Severity.MEDIUM, vehicleKind: VehicleKind.FIRE_TRUCK });
    expect(criticalAmbulance).toBeGreaterThan(mediumFire);

    const criticalFire = priorityScore({ severity: Severity.CRITICAL, vehicleKind: VehicleKind.FIRE_TRUCK });
    const mediumAmbulance = priorityScore({ severity: Severity.MEDIUM, vehicleKind: VehicleKind.AMBULANCE });
    expect(criticalFire).toBeGreaterThan(mediumAmbulance);
  });

  it('ages a waiting request so it cannot starve', () => {
    const fresh = priorityScore({ severity: Severity.MEDIUM, vehicleKind: VehicleKind.AMBULANCE, waitingSeconds: 0 });
    const waited = priorityScore({ severity: Severity.MEDIUM, vehicleKind: VehicleKind.AMBULANCE, waitingSeconds: 200 });
    expect(waited).toBeGreaterThan(fresh);
  });
});
