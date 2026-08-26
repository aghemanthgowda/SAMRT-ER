import { describe, expect, it } from 'vitest';
import { RoadGraph, pathLengthM } from '@smart-er/core';
import { buildJunctions, buildRoadSegments } from './network.js';

describe('junction network', () => {
  const junctions = buildJunctions();
  const segments = buildRoadSegments(junctions);
  const graph = new RoadGraph(junctions, segments);

  it('passes structural validation', () => {
    expect(graph.validate()).toEqual([]);
  });

  it('declares road distances that are at least the straight-line distance', () => {
    for (const segment of segments) {
      const geometric = pathLengthM(segment.path);
      // A carriageway cannot be shorter than the line between its endpoints.
      expect(segment.distanceM).toBeGreaterThanOrEqual(Math.round(geometric) - 1);
      // Nor implausibly longer for a city block.
      expect(segment.distanceM / geometric).toBeLessThan(1.35);
    }
  });

  it('models every road in both directions', () => {
    for (const segment of segments) {
      const reverse = segments.find(
        (other) =>
          other.fromJunctionId === segment.toJunctionId && other.toJunctionId === segment.fromJunctionId,
      );
      expect(reverse, `no reverse carriageway for ${segment.id}`).toBeDefined();
    }
  });

  it('is strongly connected — every junction can reach every other', () => {
    const ids = junctions.map((junction) => junction.id);
    for (const start of ids) {
      const reached = new Set<string>([start]);
      const queue = [start];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const edge of graph.edgesFrom(current)) {
          if (reached.has(edge.toJunctionId)) continue;
          reached.add(edge.toJunctionId);
          queue.push(edge.toJunctionId);
        }
      }
      expect(reached.size, `${start} cannot reach the whole network`).toBe(ids.length);
    }
  });

  it('declares conflicting approaches symmetrically', () => {
    for (const junction of junctions) {
      for (const approach of junction.approaches) {
        for (const otherId of approach.conflictsWith) {
          const other = junction.approaches.find((entry) => entry.id === otherId)!;
          expect(other.conflictsWith).toContain(approach.id);
        }
        // Opposing movements must never be declared in conflict.
        expect(approach.conflictsWith).not.toContain(approach.id);
      }
    }
  });
});
