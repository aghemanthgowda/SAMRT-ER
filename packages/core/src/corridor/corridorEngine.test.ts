import { beforeEach, describe, expect, it } from 'vitest';
import { RoadGraph } from '../graph/roadGraph.js';
import { testJunctions, testSegments } from '../testing/fixtures.js';
import type { Route } from '../types/domain.js';
import { CorridorStatus, DestinationKind, JunctionState, RouteChoiceReason, RouteSource } from '../types/enums.js';
import { resetIds } from '../util/id.js';
import { isoNow } from '../util/time.js';
import { GraphRouteProvider } from '../routing/GraphRouteProvider.js';
import { advanceCorridor, heldJunctionIds, planCorridor, releaseCorridor, timeSlotAllocation } from './corridorEngine.js';

const HOSPITAL = {
  id: 'FAC-HOSP',
  kind: DestinationKind.HOSPITAL,
  name: 'City Hospital',
  position: { lat: 12.9673, lng: 77.5905 },
};

function buildRoute(graph: RoadGraph): Route {
  const provider = new GraphRouteProvider(graph);
  const [candidate] = provider.computeRoutesSync({
    origin: { lat: 12.9722, lng: 77.6167 },
    destination: HOSPITAL,
    alternatives: 1,
    emergency: true,
  });
  if (!candidate) throw new Error('fixture route could not be computed');

  return {
    id: 'RTE-TEST',
    requestId: 'REQ-TEST',
    vehicleId: 'AMB-01',
    origin: { lat: 12.9722, lng: 77.6167 },
    destination: HOSPITAL,
    junctionIds: candidate.junctionIds,
    segments: candidate.segments,
    path: candidate.path,
    distanceM: candidate.distanceM,
    etaSeconds: candidate.etaSeconds,
    source: RouteSource.GRAPH,
    reason: RouteChoiceReason.FASTEST_SAFE,
    alternatives: [],
    explanation: 'test route',
    createdAt: isoNow(),
    active: true,
    progressIndex: 0,
  };
}

describe('rolling green corridor', () => {
  let graph: RoadGraph;
  let route: Route;

  beforeEach(() => {
    resetIds();
    graph = new RoadGraph(testJunctions(), testSegments());
    route = buildRoute(graph);
  });

  it('plans one allocation per junction, all starting NORMAL', () => {
    const corridor = planCorridor({
      route,
      vehicleId: 'AMB-01',
      requestId: 'REQ-TEST',
      priority: 120,
      graph,
    });

    expect(corridor.allocations).toHaveLength(route.junctionIds.length);
    expect(corridor.status).toBe(CorridorStatus.PENDING);
    for (const allocation of corridor.allocations) {
      expect(allocation.state).toBe(JunctionState.NORMAL);
      expect(allocation.corridorId).toBe(corridor.id);
      expect(new Date(allocation.endsAt).getTime()).toBeGreaterThan(new Date(allocation.startsAt).getTime());
    }
  });

  it('never turns the whole route green at once', () => {
    const corridor = planCorridor({ route, vehicleId: 'AMB-01', requestId: 'REQ-TEST', priority: 120, graph });

    // Sample the corridor at many points along the route; at no point may more
    // than one junction be GREEN, and the held set must stay small.
    const totalDistance = route.distanceM;
    let maxHeld = 0;

    for (let fraction = 0; fraction <= 1; fraction += 0.02) {
      const travelled = totalDistance * fraction;
      const point = pointAt(route, travelled);
      const result = advanceCorridor({
        corridor,
        route,
        graph,
        position: point,
        speedKph: 45,
      });
      const green = result.corridor.allocations.filter((a) => a.state === JunctionState.GREEN);
      expect(green.length).toBeLessThanOrEqual(1);
      maxHeld = Math.max(maxHeld, heldJunctionIds(result.corridor).length);
    }

    // GREEN + PREPARING together should never approach the full route length.
    expect(maxHeld).toBeLessThanOrEqual(2);
    expect(maxHeld).toBeLessThan(route.junctionIds.length);
  });

  it('moves the window forward and releases junctions behind the vehicle', () => {
    let corridor = planCorridor({ route, vehicleId: 'AMB-01', requestId: 'REQ-TEST', priority: 120, graph });
    const seenStates: JunctionState[] = [];
    const firstJunction = route.junctionIds[0]!;

    for (let fraction = 0; fraction <= 1.01; fraction += 0.05) {
      const point = pointAt(route, route.distanceM * Math.min(1, fraction));
      const result = advanceCorridor({ corridor, route, graph, position: point, speedKph: 45 });
      corridor = result.corridor;
      const allocation = corridor.allocations.find((a) => a.junctionId === firstJunction)!;
      if (seenStates[seenStates.length - 1] !== allocation.state) seenStates.push(allocation.state);
    }

    // The first junction must end up RELEASED and must never go back.
    expect(seenStates[seenStates.length - 1]).toBe(JunctionState.RELEASED);
    expect(seenStates.filter((state) => state === JunctionState.RELEASED)).toHaveLength(1);
    expect(corridor.releasedJunctionIds).toContain(firstJunction);
  });

  it('a released junction never re-enters the corridor after a bad GPS fix', () => {
    let corridor = planCorridor({ route, vehicleId: 'AMB-01', requestId: 'REQ-TEST', priority: 120, graph });

    // Drive most of the way so the junctions behind the vehicle are released.
    corridor = advanceCorridor({
      corridor,
      route,
      graph,
      position: pointAt(route, route.distanceM * 0.9),
      speedKph: 45,
    }).corridor;

    const released = [...corridor.releasedJunctionIds];
    expect(released.length).toBeGreaterThan(0);

    // Now a stale or reflected fix puts the vehicle back at the start. Junctions
    // it has already cleared must stay released — re-reserving them would stop
    // traffic that has just been let go.
    const rewound = advanceCorridor({
      corridor,
      route,
      graph,
      position: pointAt(route, 0),
      speedKph: 45,
    }).corridor;

    for (const junctionId of released) {
      const allocation = rewound.allocations.find((entry) => entry.junctionId === junctionId)!;
      expect(allocation.state).toBe(JunctionState.RELEASED);
    }
    expect(rewound.releasedJunctionIds).toEqual(expect.arrayContaining(released));
  });

  it('reports completion once every junction is released', () => {
    const corridor = planCorridor({ route, vehicleId: 'AMB-01', requestId: 'REQ-TEST', priority: 120, graph });
    const result = advanceCorridor({
      corridor,
      route,
      graph,
      position: pointAt(route, route.distanceM + 500),
      speedKph: 45,
    });
    expect(result.completed).toBe(true);
    expect(result.corridor.status).toBe(CorridorStatus.RELEASED);
    expect(heldJunctionIds(result.corridor)).toHaveLength(0);
  });

  it('releaseCorridor hands every junction back to public traffic', () => {
    const corridor = planCorridor({ route, vehicleId: 'AMB-01', requestId: 'REQ-TEST', priority: 120, graph });
    const result = releaseCorridor(corridor);

    expect(result.completed).toBe(true);
    expect(result.corridor.status).toBe(CorridorStatus.RELEASED);
    expect(result.corridor.activeJunctionId).toBeUndefined();
    expect(result.corridor.preparingJunctionIds).toHaveLength(0);
    expect(result.changed.length).toBe(corridor.allocations.length);
    for (const allocation of result.corridor.allocations) {
      expect(allocation.state).toBe(JunctionState.RELEASED);
      expect(allocation.releasedAt).toBeDefined();
    }
  });

  it('time-slotting shifts exactly one junction window', () => {
    const corridor = planCorridor({ route, vehicleId: 'FIRE-01', requestId: 'REQ-F', priority: 90, graph });
    const target = corridor.junctionIds[1] ?? corridor.junctionIds[0]!;
    const before = corridor.allocations.find((a) => a.junctionId === target)!;

    const slotted = timeSlotAllocation(corridor, target, 8);
    const after = slotted.allocations.find((a) => a.junctionId === target)!;

    expect(after.timeSlotted).toBe(true);
    expect(new Date(after.startsAt).getTime() - new Date(before.startsAt).getTime()).toBe(8000);
    expect(new Date(after.endsAt).getTime() - new Date(before.endsAt).getTime()).toBe(8000);

    for (const allocation of slotted.allocations) {
      if (allocation.junctionId === target) continue;
      expect(allocation.timeSlotted).toBe(false);
    }
  });

  it('predicts monotonically increasing arrival times along the route', () => {
    const corridor = planCorridor({ route, vehicleId: 'AMB-01', requestId: 'REQ-TEST', priority: 120, graph });
    const starts = corridor.allocations.map((a) => new Date(a.startsAt).getTime());
    for (let i = 1; i < starts.length; i += 1) {
      expect(starts[i]!).toBeGreaterThanOrEqual(starts[i - 1]!);
    }
  });
});

/** Walk the route polyline to a given distance — mirrors how the simulator moves. */
function pointAt(route: Route, distanceM: number) {
  const path = route.path;
  let travelled = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const leg = haversine(a, b);
    if (travelled + leg >= distanceM) {
      const t = leg === 0 ? 0 : (distanceM - travelled) / leg;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    travelled += leg;
  }
  return path[path.length - 1]!;
}

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371008.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
