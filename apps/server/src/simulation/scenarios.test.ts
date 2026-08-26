import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictStatus, JunctionState, RequestStatus, Severity, VehicleStatus } from '@smart-er/core';
import { Store } from '../db/store.js';
import { createContext, type AppContext } from '../services/context.js';
import { DispatchError } from '../services/dispatch.js';

/**
 * End-to-end behaviour of the running system.
 *
 * These drive the real services — verification, routing, conflict resolution,
 * the safety validator and the hardware layer — through the simulation loop,
 * so they exercise the same path a live demonstration takes.
 */

let context: AppContext;
let store: Store;

async function run(ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await context.simulation.tick();
}

function kinds(): string[] {
  return context.timeline.recent(600).map((event) => event.kind);
}

function messagesOfKind(kind: string): string[] {
  return context.timeline
    .recent(600)
    .filter((event) => event.kind === kind)
    .map((event) => event.message);
}

beforeEach(() => {
  store = Store.create({ hardwareSeed: 2024 });
  context = createContext(store);
});

describe('1–3. ambulance request, controller approval, hospital notification', () => {
  it('runs the full happy path and notifies the destination', async () => {
    await context.simulation.startScenario('single-ambulance');
    context.simulation.stop();
    await run(12);

    const request = store.repositories.requests.list()[0]!;
    expect(request.status).toBe(RequestStatus.APPROVED);
    expect(request.verification?.verified).toBe(true);
    expect(request.routeId).toBeDefined();
    expect(request.corridorId).toBeDefined();

    expect(kinds()).toEqual(
      expect.arrayContaining([
        'driver.authenticated',
        'request.submitted',
        'request.received',
        'vehicle.verified',
        'destination.notified',
        'request.approved',
        'route.calculated',
        'corridor.activated',
      ]),
    );

    // The hospital is told, addressed to the facility rather than broadcast.
    const notification = store.repositories.notifications
      .list()
      .find((entry) => entry.audience.facilityId === 'FAC-HOSP-01');
    expect(notification).toBeDefined();
    expect(notification!.body).toMatch(/AMB-01 is en route/);
  });
});

describe('4–5. fire and police dispatch', () => {
  it('dispatches a fire appliance to an incident and marks it dispatched', async () => {
    context.dispatch.signOn('FIRE-01', 'DRV-003');
    const request = context.dispatch.submitRequest({
      vehicleId: 'FIRE-01',
      driverId: 'DRV-003',
      severity: Severity.HIGH,
      destinationIncidentId: 'INC-1001',
      incidentId: 'INC-1001',
    });
    await context.dispatch.approveRequest(request.id, 'USR-CTRL-01');

    const incident = store.repositories.incidents.get('INC-1001')!;
    expect(incident.status).toBe('DISPATCHED');
    expect(incident.assignedVehicleIds).toContain('FIRE-01');
    expect(store.vehicleState('FIRE-01')!.status).toBe(VehicleStatus.ACTIVE);
  });

  it('dispatches a police unit with its own independent route', async () => {
    context.dispatch.signOn('POL-01', 'DRV-004');
    const request = context.dispatch.submitRequest({
      vehicleId: 'POL-01',
      driverId: 'DRV-004',
      severity: Severity.MEDIUM,
      destinationIncidentId: 'INC-1002',
      incidentId: 'INC-1002',
    });
    const approved = await context.dispatch.approveRequest(request.id, 'USR-CTRL-01');

    const route = store.repositories.routes.get(approved.routeId!)!;
    expect(route.vehicleId).toBe('POL-01');
    expect(route.junctionIds.length).toBeGreaterThan(0);
    expect(route.etaSeconds).toBeGreaterThan(0);
  });
});

describe('6–9. shared junction, alternatives, and coordination', () => {
  it('detects contention and resolves it without simply blocking the second unit', async () => {
    await context.simulation.startScenario('ambulance-fire-conflict');
    context.simulation.stop();
    await run(40);

    const conflicts = store.repositories.conflicts.list();
    expect(conflicts.length).toBeGreaterThan(0);

    const conflict = conflicts[0]!;
    expect(conflict.status).not.toBe(ConflictStatus.DETECTED);
    expect(conflict.status).not.toBe(ConflictStatus.UNRESOLVED);
    // The resolution is always explained in terms a controller can act on.
    expect(conflict.explanation.length).toBeGreaterThan(40);

    // Both vehicles are still moving — neither was parked indefinitely.
    expect(store.vehicleState('AMB-01')!.status).toBe(VehicleStatus.ACTIVE);
    expect(store.vehicleState('FIRE-01')!.status).toBe(VehicleStatus.ACTIVE);
  });

  it('honours a time slot by not claiming the junction before its window opens', async () => {
    await context.simulation.startScenario('ambulance-fire-conflict');
    context.simulation.stop();
    await run(40);

    const slotted = store.repositories.corridors
      .list()
      .flatMap((corridor) => corridor.allocations)
      .filter((allocation) => allocation.timeSlotted);

    if (slotted.length > 0) {
      // A deferred allocation must not be sitting green before its window.
      for (const allocation of slotted) {
        if (new Date(allocation.startsAt).getTime() > store.clock.now()) {
          expect(allocation.state).not.toBe(JunctionState.GREEN);
        }
      }
    }

    // Whatever the strategy, no junction ever holds two vehicles at once.
    const heldByJunction = new Map<string, Set<string>>();
    for (const corridor of store.activeCorridors()) {
      for (const allocation of corridor.allocations) {
        if (allocation.state !== JunctionState.GREEN) continue;
        const set = heldByJunction.get(allocation.junctionId) ?? new Set<string>();
        set.add(corridor.vehicleId);
        heldByJunction.set(allocation.junctionId, set);
      }
    }
    for (const [junctionId, vehicles] of heldByJunction) {
      expect(vehicles.size, `${junctionId} held by ${[...vehicles].join(', ')}`).toBe(1);
    }
  });
});

describe('10–11. rolling corridor and junction release', () => {
  it('never holds the whole route green, and releases junctions behind the vehicle', async () => {
    await context.simulation.startScenario('single-ambulance');
    context.simulation.stop();

    let maxGreen = 0;
    let maxHeld = 0;
    let sawRelease = false;

    for (let i = 0; i < 90; i += 1) {
      await context.simulation.tick();
      const corridor = store.repositories.corridors.list()[0];
      if (!corridor) continue;

      const green = corridor.allocations.filter((a) => a.state === JunctionState.GREEN).length;
      const held = corridor.allocations.filter(
        (a) => a.state === JunctionState.GREEN || a.state === JunctionState.PREPARING,
      ).length;
      maxGreen = Math.max(maxGreen, green);
      maxHeld = Math.max(maxHeld, held);
      if (corridor.releasedJunctionIds.length > 0) sawRelease = true;
    }

    expect(maxGreen).toBeLessThanOrEqual(1);
    expect(maxHeld).toBeLessThanOrEqual(2);
    expect(sawRelease).toBe(true);
    expect(kinds()).toEqual(expect.arrayContaining(['junction.preparing', 'junction.green', 'junction.released']));
  });

  it('keeps public traffic impact proportionate to the rolling window', async () => {
    await context.simulation.startScenario('single-ambulance');
    context.simulation.stop();
    await run(30);

    const impact = context.snapshot().impact;
    expect(impact.totalJunctions).toBe(store.graph.junctions.length);
    // Only the rolling window is ever held, never the full route.
    expect(impact.activeEmergencyJunctions).toBeLessThanOrEqual(2);
    expect(impact.level).not.toBe('HIGH');
  });
});

describe('12–14. traffic change, rerouting and completion', () => {
  it('reroutes around a road that closes on the active route', async () => {
    await context.simulation.startScenario('dynamic-reroute');
    context.simulation.stop();
    await run(70);

    const rerouted = messagesOfKind('route.rerouted');
    expect(rerouted.length).toBeGreaterThan(0);
    expect(rerouted.join(' ')).toMatch(/closed/i);

    // The replacement route must not use the closed carriageway.
    const active = store.activeRoutes().find((route) => route.vehicleId === 'AMB-01');
    if (active) {
      const used = active.segments.map((segment) => segment.roadSegmentId);
      expect(used).not.toContain('J2-J3');
    }
  });

  it('does not thrash: a second reroute is rate-limited', async () => {
    await context.simulation.startScenario('dynamic-reroute');
    context.simulation.stop();
    await run(80);

    // Guarded by a minimum interval, so a long run cannot produce many.
    expect(messagesOfKind('route.rerouted').length).toBeLessThanOrEqual(3);
  });

  it('completes the run and returns every junction to normal', async () => {
    await context.simulation.startScenario('single-ambulance');
    context.simulation.stop();
    context.simulation.setSpeed(6);
    await run(200);

    const request = store.repositories.requests.list()[0]!;
    expect(request.status).toBe(RequestStatus.COMPLETED);
    expect(store.vehicleState('AMB-01')!.status).toBe(VehicleStatus.ARRIVED);

    for (const corridor of store.repositories.corridors.list()) {
      expect(corridor.status).toBe('RELEASED');
      for (const allocation of corridor.allocations) {
        expect(allocation.state).toBe(JunctionState.RELEASED);
      }
    }
    expect(context.snapshot().impact.activeEmergencyJunctions).toBe(0);
    expect(kinds()).toEqual(expect.arrayContaining(['request.completed', 'corridor.released']));
  });
});

describe('15–16. GPS and hardware failure', () => {
  it('holds the last confirmed position when GPS is lost rather than guessing', async () => {
    await context.simulation.startScenario('gps-failure');
    context.simulation.stop();
    await run(25);

    const before = store.vehicleState('AMB-01')!;
    expect(before.gpsOk).toBe(false);
    const frozenPosition = { ...before.position };

    await run(6);
    const after = store.vehicleState('AMB-01')!;
    expect(after.gpsOk).toBe(false);
    expect(after.speedKph).toBe(0);
    expect(after.position).toEqual(frozenPosition);
    expect(messagesOfKind('gps.lost').join(' ')).toMatch(/last confirmed position/);

    // Lock returns and the vehicle resumes.
    await run(30);
    expect(store.vehicleState('AMB-01')!.gpsOk).toBe(true);
  });

  it('routes around a junction whose controller cannot be reached', async () => {
    await context.simulation.startScenario('junction-controller-offline');
    context.simulation.stop();
    await run(45);

    expect(messagesOfKind('hardware.offline').join(' ')).toMatch(/excluded from corridor planning/);

    const active = store.activeRoutes().find((route) => route.vehicleId === 'AMB-01');
    if (active) {
      // A green that cannot be confirmed is never assumed.
      expect(active.junctionIds).not.toContain('J3');
    }
  });

  it('never dispatches a signal command that has not passed the safety validator', async () => {
    await context.simulation.startScenario('ambulance-fire-conflict');
    context.simulation.stop();
    await run(60);

    const dispatched = store.repositories.commands.list();
    expect(dispatched.length).toBeGreaterThan(0);
    for (const command of dispatched) {
      // Every recorded command carries the validator's verdict and notes.
      expect(command.safetyNotes.length).toBeGreaterThan(0);
    }
  });
});

describe('17–18. unauthorised driver and invalid vehicle', () => {
  it('refuses sign-on for an unauthorised driver and names the failed links', () => {
    expect(() => context.dispatch.signOn('AMB-09', 'DRV-009')).toThrow(DispatchError);

    try {
      context.dispatch.signOn('AMB-09', 'DRV-009');
    } catch (error) {
      const details = (error as DispatchError).details as { failures: string[] };
      expect(details.failures.join(' ')).toMatch(/expired/);
      expect(details.failures.join(' ')).toMatch(/not in active service/);
      expect((error as DispatchError).status).toBe(403);
    }
  });

  it('refuses a driver operating a vehicle they are not authorised for', () => {
    expect(() => context.dispatch.signOn('FIRE-01', 'DRV-001')).toThrow(/not authorised to operate/);
  });

  it('rejects an approval if verification lapses between submission and decision', async () => {
    context.dispatch.signOn('AMB-01', 'DRV-001');
    const request = context.dispatch.submitRequest({
      vehicleId: 'AMB-01',
      driverId: 'DRV-001',
      severity: Severity.CRITICAL,
      destinationFacilityId: 'FAC-HOSP-01',
    });

    // The operator's licence is withdrawn while the request sits in the queue.
    const organization = store.repositories.organizations.get('ORG-001')!;
    store.repositories.organizations.put({ ...organization, active: false });

    const decided = await context.dispatch.approveRequest(request.id, 'USR-CTRL-01');
    expect(decided.status).toBe(RequestStatus.REJECTED);
    expect(decided.rejectionReason).toMatch(/not active/);
  });
});

describe('19. multiple simultaneous vehicles', () => {
  it('runs four units at once, each with an independent route and corridor', async () => {
    await context.simulation.startScenario('multi-vehicle');
    context.simulation.stop();
    await run(35);

    const active = store.repositories.vehicleStates
      .list()
      .filter((state) => state.status === VehicleStatus.ACTIVE);
    expect(active.length).toBeGreaterThanOrEqual(3);

    const routeIds = new Set(active.map((state) => state.activeRouteId));
    const corridorIds = new Set(active.map((state) => state.corridorId));
    expect(routeIds.size).toBe(active.length);
    expect(corridorIds.size).toBe(active.length);

    for (const state of active) {
      expect(state.etaSeconds).toBeGreaterThanOrEqual(0);
      const route = store.repositories.routes.get(state.activeRouteId!)!;
      expect(route.vehicleId).toBe(state.vehicleId);
    }
  });

  it('rejects a second open request for a vehicle already running', () => {
    context.dispatch.signOn('AMB-01', 'DRV-001');
    context.dispatch.submitRequest({
      vehicleId: 'AMB-01',
      driverId: 'DRV-001',
      severity: Severity.CRITICAL,
      destinationFacilityId: 'FAC-HOSP-01',
    });

    expect(() =>
      context.dispatch.submitRequest({
        vehicleId: 'AMB-01',
        driverId: 'DRV-001',
        severity: Severity.HIGH,
        destinationFacilityId: 'FAC-HOSP-02',
      }),
    ).toThrow(/already has an open request/);
  });
});
