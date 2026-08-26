import { describe, expect, it } from 'vitest';
import {
  bearingDelta,
  bearingDeg,
  decodePolyline,
  distanceToPathM,
  encodePolyline,
  haversineM,
  pathLengthM,
  pointAtDistance,
  projectDistanceAlongPath,
  slicePath,
} from './geometry.js';

const MG_ROAD = { lat: 12.9746, lng: 77.6094 };
const TRINITY = { lat: 12.9722, lng: 77.6167 };

describe('geometry', () => {
  it('measures a known city distance within a sensible tolerance', () => {
    const metres = haversineM(MG_ROAD, TRINITY);
    expect(metres).toBeGreaterThan(700);
    expect(metres).toBeLessThan(1000);
  });

  it('returns zero distance for identical points', () => {
    expect(haversineM(MG_ROAD, MG_ROAD)).toBe(0);
  });

  it('computes bearings and their smallest difference', () => {
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 1);
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 1);
    expect(bearingDelta(350, 10)).toBe(20);
    expect(bearingDelta(10, 350)).toBe(20);
    expect(bearingDelta(0, 180)).toBe(180);
  });

  it('walks a polyline to an exact distance', () => {
    const path = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
      { lat: 0, lng: 0.02 },
    ];
    const total = pathLengthM(path);
    const mid = pointAtDistance(path, total / 2);
    expect(mid.position.lng).toBeCloseTo(0.01, 4);
    expect(mid.distanceFromStartM).toBeCloseTo(total / 2, 2);
  });

  it('clamps out-of-range distances to the ends of the path', () => {
    const path = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
    ];
    expect(pointAtDistance(path, -50).position).toEqual(path[0]);
    expect(pointAtDistance(path, 1e9).position).toEqual(path[1]);
  });

  it('throws only on an empty path', () => {
    expect(() => pointAtDistance([], 10)).toThrow();
    expect(pointAtDistance([MG_ROAD], 10).position).toEqual(MG_ROAD);
  });

  it('projects a point back onto the path it sits near', () => {
    const path = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.02 },
    ];
    const total = pathLengthM(path);
    const progress = projectDistanceAlongPath({ lat: 0.00001, lng: 0.01 }, path);
    expect(progress).toBeGreaterThan(total * 0.45);
    expect(progress).toBeLessThan(total * 0.55);
  });

  it('measures the distance from a point to a path', () => {
    const path = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.02 },
    ];
    expect(distanceToPathM({ lat: 0, lng: 0.01 }, path)).toBeLessThan(1);
    expect(distanceToPathM({ lat: 0.01, lng: 0.01 }, path)).toBeGreaterThan(1000);
  });

  it('slices a path between two distances', () => {
    const path = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
      { lat: 0, lng: 0.02 },
    ];
    const total = pathLengthM(path);
    const slice = slicePath(path, total * 0.25, total * 0.75);
    expect(slice.length).toBeGreaterThanOrEqual(2);
    expect(pathLengthM(slice)).toBeCloseTo(total * 0.5, 0);
    expect(slicePath(path, total, total * 0.5)).toEqual([]);
  });

  it('round-trips an encoded polyline', () => {
    const path = [MG_ROAD, TRINITY, { lat: 12.9614, lng: 77.5966 }];
    const decoded = decodePolyline(encodePolyline(path));
    expect(decoded).toHaveLength(path.length);
    decoded.forEach((point, index) => {
      expect(point.lat).toBeCloseTo(path[index]!.lat, 4);
      expect(point.lng).toBeCloseTo(path[index]!.lng, 4);
    });
  });

  it('decodes the polyline example from the Google encoding specification', () => {
    const decoded = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decoded).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });
});
