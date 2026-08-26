import type { LatLng } from '../types/domain.js';

const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Great-circle distance in metres between two coordinates. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees clockwise from true north, travelling a → b. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * RAD_TO_DEG + 360) % 360;
}

/** Smallest absolute difference between two bearings, in degrees (0–180). */
export function bearingDelta(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360) + 360) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** Linear interpolation between two coordinates. `t` is clamped to [0, 1]. */
export function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    lat: a.lat + (b.lat - a.lat) * clamped,
    lng: a.lng + (b.lng - a.lng) * clamped,
  };
}

/** Total length of a polyline in metres. */
export function pathLengthM(path: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += haversineM(path[i - 1]!, path[i]!);
  }
  return total;
}

export interface PointOnPath {
  position: LatLng;
  /** Index of the polyline vertex immediately behind `position`. */
  segmentIndex: number;
  /** Distance travelled from the start of the path, in metres. */
  distanceFromStartM: number;
  /** Bearing of travel at this point. */
  heading: number;
}

/**
 * Walk `distanceM` along a polyline from its start.
 *
 * This is what moves a simulated vehicle: given a Google-derived route polyline
 * and a distance, it returns the exact coordinate and heading. The same helper
 * is used by the corridor engine to work out where a vehicle will be at a
 * future point in time.
 */
export function pointAtDistance(path: readonly LatLng[], distanceM: number): PointOnPath {
  if (path.length === 0) {
    throw new Error('pointAtDistance: path is empty');
  }
  const first = path[0]!;
  if (path.length === 1) {
    return { position: first, segmentIndex: 0, distanceFromStartM: 0, heading: 0 };
  }
  if (distanceM <= 0) {
    return { position: first, segmentIndex: 0, distanceFromStartM: 0, heading: bearingDeg(first, path[1]!) };
  }

  let travelled = 0;
  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1]!;
    const next = path[i]!;
    const legLength = haversineM(prev, next);
    if (travelled + legLength >= distanceM) {
      const t = legLength === 0 ? 0 : (distanceM - travelled) / legLength;
      return {
        position: interpolate(prev, next, t),
        segmentIndex: i - 1,
        distanceFromStartM: distanceM,
        heading: bearingDeg(prev, next),
      };
    }
    travelled += legLength;
  }

  const last = path[path.length - 1]!;
  const penultimate = path[path.length - 2]!;
  return {
    position: last,
    segmentIndex: path.length - 2,
    distanceFromStartM: travelled,
    heading: bearingDeg(penultimate, last),
  };
}

/**
 * Distance in metres from `point` to the closest place on the polyline.
 * Uses a local equirectangular projection, which is accurate at city scale.
 */
export function distanceToPathM(point: LatLng, path: readonly LatLng[]): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return haversineM(point, path[0]!);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < path.length; i += 1) {
    best = Math.min(best, distanceToSegmentM(point, path[i - 1]!, path[i]!));
  }
  return best;
}

function distanceToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  const latRef = (a.lat + b.lat) / 2;
  const mPerDegLat = 111_132.92;
  const mPerDegLng = 111_412.84 * Math.cos(latRef * DEG_TO_RAD);

  const px = (p.lng - a.lng) * mPerDegLng;
  const py = (p.lat - a.lat) * mPerDegLat;
  const bx = (b.lng - a.lng) * mPerDegLng;
  const by = (b.lat - a.lat) * mPerDegLat;

  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  return Math.hypot(px - t * bx, py - t * by);
}

/**
 * How far along the polyline the given point projects, in metres.
 * Used to convert a raw GPS fix back into route progress.
 */
export function projectDistanceAlongPath(point: LatLng, path: readonly LatLng[]): number {
  if (path.length < 2) return 0;
  let travelled = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProgress = 0;

  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const legLength = haversineM(a, b);
    const d = distanceToSegmentM(point, a, b);
    if (d < bestDistance) {
      bestDistance = d;
      const along = legLength === 0 ? 0 : legLength * projectionRatio(point, a, b);
      bestProgress = travelled + Math.max(0, Math.min(legLength, along));
    }
    travelled += legLength;
  }
  return bestProgress;
}

function projectionRatio(p: LatLng, a: LatLng, b: LatLng): number {
  const latRef = (a.lat + b.lat) / 2;
  const mPerDegLat = 111_132.92;
  const mPerDegLng = 111_412.84 * Math.cos(latRef * DEG_TO_RAD);
  const px = (p.lng - a.lng) * mPerDegLng;
  const py = (p.lat - a.lat) * mPerDegLat;
  const bx = (b.lng - a.lng) * mPerDegLng;
  const by = (b.lat - a.lat) * mPerDegLat;
  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return 0;
  return Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
}

/** Slice a polyline between two distances from its start. */
export function slicePath(path: readonly LatLng[], fromM: number, toM: number): LatLng[] {
  if (path.length < 2 || toM <= fromM) return [];
  const start = pointAtDistance(path, fromM);
  const end = pointAtDistance(path, toM);
  const out: LatLng[] = [start.position];
  for (let i = start.segmentIndex + 1; i <= end.segmentIndex; i += 1) {
    out.push(path[i]!);
  }
  out.push(end.position);
  return out;
}

/**
 * Decode a Google encoded polyline into coordinates.
 * Routes API responses carry geometry in this format.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/** Encode coordinates into a Google encoded polyline. */
export function encodePolyline(path: readonly LatLng[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = '';
  for (const point of path) {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);
    out += encodeSignedNumber(lat - lastLat) + encodeSignedNumber(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}

function encodeSignedNumber(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  out += String.fromCharCode(v + 63);
  return out;
}

/** Axis-aligned bounds of a set of points, padded by `padDeg`. */
export function boundsOf(points: readonly LatLng[], padDeg = 0.002) {
  if (points.length === 0) {
    return { north: 0, south: 0, east: 0, west: 0 };
  }
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const p of points) {
    north = Math.max(north, p.lat);
    south = Math.min(south, p.lat);
    east = Math.max(east, p.lng);
    west = Math.min(west, p.lng);
  }
  return { north: north + padDeg, south: south - padDeg, east: east + padDeg, west: west - padDeg };
}
