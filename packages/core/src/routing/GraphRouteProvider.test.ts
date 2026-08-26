import { beforeEach, describe, expect, it } from 'vitest';
import { RoadGraph } from '../graph/roadGraph.js';
import { testJunctions, testSegments } from '../testing/fixtures.js';
import { DestinationKind, TrafficLevel } from '../types/enums.js';
import { resetIds } from '../util/id.js';
import { GraphRouteProvider } from './GraphRouteProvider.js';

function buildGraph() {
  return new RoadGraph(testJunctions(), testSegments());
}

const HOSPITAL = {
  id: 'FAC-HOSP',
  kind: DestinationKind.HOSPITAL,
  name: 'City Hospital',
  position: { lat: 12.9757, lng: 77.6031 },
};

describe('GraphRouteProvider', () => {
  beforeEach(() => resetIds());

  it('produces a connected route whose segments chain end to end', () => {
    const graph = buildGraph();
    const provider = new GraphRouteProvider(graph);
    const [route] = provider.computeRoutesSync({
      origin: { lat: 12.9722, lng: 77.6167 },
      destination: HOSPITAL,
      emergency: true,
    });

    expect(route).toBeDefined();
    expect(route!.junctionIds.length).toBeGreaterThan(1);
    for (let i = 1; i < route!.junctionIds.length; i += 1) {
      const segment = route!.segments[i - 1];
      expect(segment!.fromJunctionId).toBe(route!.junctionIds[i - 1]);
      expect(segment!.toJunctionId).toBe(route!.junctionIds[i]);
    }
  });

  it('returns distinct alternatives, cheapest first', () => {
    const graph = buildGraph();
    const provider = new GraphRouteProvider(graph);
    const routes = provider.computeRoutesSync({
      origin: { lat: 12.9614, lng: 77.5966 },
      destination: HOSPITAL,
      alternatives: 3,
      emergency: true,
    });

    expect(routes.length).toBeGreaterThanOrEqual(2);
    const signatures = new Set(routes.map((route) => route.junctionIds.join('>')));
    expect(signatures.size).toBe(routes.length);
    for (let i = 1; i < routes.length; i += 1) {
      expect(routes[i]!.cost).toBeGreaterThanOrEqual(routes[i - 1]!.cost);
    }
  });

  it('optimises minimum response time, not shortest distance', () => {
    // Congest the short MG Road corridor so the longer southern loop is faster.
    const graph = buildGraph();
    for (const id of ['J1-J2-F', 'J2-J3-F']) {
      graph.setTraffic(id, TrafficLevel.HEAVY);
    }

    const provider = new GraphRouteProvider(graph);
    const routes = provider.computeRoutesSync({
      origin: { lat: 12.9722, lng: 77.6167 },
      destination: HOSPITAL,
      alternatives: 4,
      emergency: true,
    });

    const chosen = routes[0]!;
    const shortest = [...routes].sort((a, b) => a.distanceM - b.distanceM)[0]!;

    // The selected route must never be slower than the shortest one.
    expect(chosen.etaSeconds).toBeLessThanOrEqual(shortest.etaSeconds);

    // And when a genuinely longer-but-faster option exists, it is preferred.
    const longerButFaster = routes.find(
      (route) => route.distanceM > shortest.distanceM && route.etaSeconds < shortest.etaSeconds,
    );
    if (longerButFaster) {
      expect(chosen.etaSeconds).toBeLessThanOrEqual(longerButFaster.etaSeconds);
    }
  });

  it('never routes over a blocked road', () => {
    const graph = buildGraph();
    graph.setBlocked('J1-J2-F', true);
    graph.setBlocked('J1-J6-F', true);

    const provider = new GraphRouteProvider(graph);
    const routes = provider.computeRoutesSync({
      origin: { lat: 12.9722, lng: 77.6167 },
      destination: HOSPITAL,
      alternatives: 3,
      emergency: true,
    });

    for (const route of routes) {
      const used = route.segments.map((segment) => segment.roadSegmentId);
      expect(used).not.toContain('J1-J2-F');
      expect(used).not.toContain('J1-J6-F');
    }
  });

  it('honours a hard junction exclusion', () => {
    const graph = buildGraph();
    const provider = new GraphRouteProvider(graph);
    const routes = provider.computeRoutesSync({
      origin: { lat: 12.9614, lng: 77.5966 },
      destination: { ...HOSPITAL, position: { lat: 12.9673, lng: 77.5905 } },
      alternatives: 3,
      excludeJunctionIds: ['J2'],
      emergency: true,
    });

    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.junctionIds).not.toContain('J2');
    }
  });

  it('penalises junctions reserved by a higher-priority corridor', () => {
    const graph = buildGraph();
    const unreserved = new GraphRouteProvider(graph).computeRoutesSync({
      origin: { lat: 12.9614, lng: 77.5966 },
      destination: { ...HOSPITAL, position: { lat: 12.9673, lng: 77.5905 } },
      alternatives: 4,
      emergency: true,
    });

    const reserved = new GraphRouteProvider(graph, {
      priority: 50,
      reservations: [{ junctionId: 'J2', vehicleId: 'AMB-01', priority: 120 }],
    }).computeRoutesSync({
      origin: { lat: 12.9614, lng: 77.5966 },
      destination: { ...HOSPITAL, position: { lat: 12.9673, lng: 77.5905 } },
      alternatives: 4,
      emergency: true,
    });

    const viaJ2 = unreserved.find((route) => route.junctionIds.includes('J2'));
    expect(viaJ2).toBeDefined();

    // With J2 reserved by a higher priority, the top pick should avoid it if any
    // alternative exists at all.
    const alternativesWithoutJ2 = reserved.filter((route) => !route.junctionIds.includes('J2'));
    if (alternativesWithoutJ2.length > 0) {
      expect(reserved[0]!.junctionIds).not.toContain('J2');
    }
    const flagged = reserved.find((route) => route.junctionIds.includes('J2'));
    if (flagged) {
      expect(flagged.conflictingJunctionIds).toContain('J2');
    }
  });

  it('returns no route when the destination is unreachable', () => {
    const graph = buildGraph();
    // Sever every road into J5 and J7 so Corporation Circle is isolated.
    for (const segment of graph.segments) {
      if (segment.toJunctionId === 'J5' || segment.fromJunctionId === 'J5') {
        graph.setBlocked(segment.id, true);
      }
    }
    const provider = new GraphRouteProvider(graph);
    const routes = provider.computeRoutesSync({
      origin: { lat: 12.9722, lng: 77.6167 },
      destination: { ...HOSPITAL, position: { lat: 12.9673, lng: 77.5905 } },
      excludeJunctionIds: ['J3', 'J7', 'J2', 'J6', 'J4', 'J1'],
      emergency: true,
    });
    expect(routes).toHaveLength(0);
  });

  it('computes a travel-time matrix across several units', async () => {
    const graph = buildGraph();
    const provider = new GraphRouteProvider(graph);
    const cells = await provider.computeMatrix({
      origins: [
        { lat: 12.9722, lng: 77.6167 },
        { lat: 12.9614, lng: 77.5966 },
      ],
      destinations: [{ lat: 12.9757, lng: 77.6031 }],
      emergency: true,
    });

    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      expect(cell.reachable).toBe(true);
      expect(cell.etaSeconds).toBeGreaterThan(0);
      expect(Number.isFinite(cell.distanceM)).toBe(true);
    }
  });
});
