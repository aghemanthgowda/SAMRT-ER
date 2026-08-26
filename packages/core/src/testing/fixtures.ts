import type { Junction, RoadSegment } from '../types/domain.js';
import { TrafficLevel } from '../types/enums.js';

/**
 * A small, fully-connected test network.
 *
 * Deliberately shaped to reproduce the brief's worked examples:
 *   - AMB route  J1 → J2 → J3 → hospital
 *   - FIRE route J4 → J2 → J5 → fire site   (contends for J2)
 *   - a detour   J4 → J6 → J7 → J5          (conflict-free alternative)
 *
 * Coordinates sit in central Bengaluru so the geometry is realistic, but no
 * test depends on the exact values.
 */

interface JunctionSpec {
  code: string;
  name: string;
  lat: number;
  lng: number;
  throughput: number;
}

const SPECS: JunctionSpec[] = [
  { code: 'J1', name: 'Trinity Circle', lat: 12.9722, lng: 77.6167, throughput: 3600 },
  { code: 'J2', name: 'MG Road / Brigade Road', lat: 12.9746, lng: 77.6094, throughput: 5200 },
  { code: 'J3', name: 'Anil Kumble Circle', lat: 12.9757, lng: 77.6035, throughput: 4100 },
  { code: 'J4', name: 'Richmond Circle', lat: 12.9614, lng: 77.5966, throughput: 4400 },
  { code: 'J5', name: 'Corporation Circle', lat: 12.9673, lng: 77.5905, throughput: 3800 },
  { code: 'J6', name: 'Double Road Junction', lat: 12.9639, lng: 77.6041, throughput: 2900 },
  { code: 'J7', name: 'Hudson Circle', lat: 12.9670, lng: 77.5953, throughput: 3100 },
];

export function testJunctions(): Junction[] {
  return SPECS.map((spec) => ({
    id: spec.code,
    code: spec.code,
    name: spec.name,
    position: { lat: spec.lat, lng: spec.lng },
    hardwareDeviceId: `HW-${spec.code}`,
    clearanceSeconds: 6,
    averageThroughputVph: spec.throughput,
    approaches: [
      { id: `${spec.code}-N`, bearing: 180, name: 'North approach', conflictsWith: [`${spec.code}-E`, `${spec.code}-W`] },
      { id: `${spec.code}-E`, bearing: 270, name: 'East approach', conflictsWith: [`${spec.code}-N`, `${spec.code}-S`] },
      { id: `${spec.code}-S`, bearing: 0, name: 'South approach', conflictsWith: [`${spec.code}-E`, `${spec.code}-W`] },
      { id: `${spec.code}-W`, bearing: 90, name: 'West approach', conflictsWith: [`${spec.code}-N`, `${spec.code}-S`] },
    ],
  }));
}

interface LinkSpec {
  from: string;
  to: string;
  distanceM: number;
  speedLimitKph: number;
  name: string;
  traffic?: TrafficLevel;
}

const LINKS: LinkSpec[] = [
  { from: 'J1', to: 'J2', distanceM: 900, speedLimitKph: 40, name: 'MG Road' },
  { from: 'J2', to: 'J3', distanceM: 700, speedLimitKph: 40, name: 'MG Road West' },
  { from: 'J3', to: 'J5', distanceM: 1500, speedLimitKph: 50, name: 'Cubbon Road' },
  { from: 'J4', to: 'J2', distanceM: 1600, speedLimitKph: 45, name: 'Brigade Road' },
  { from: 'J2', to: 'J5', distanceM: 2100, speedLimitKph: 45, name: 'Kasturba Road' },
  { from: 'J4', to: 'J6', distanceM: 850, speedLimitKph: 45, name: 'Richmond Road' },
  { from: 'J6', to: 'J7', distanceM: 1000, speedLimitKph: 50, name: 'Double Road' },
  { from: 'J7', to: 'J5', distanceM: 550, speedLimitKph: 45, name: 'Hudson Link' },
  { from: 'J1', to: 'J6', distanceM: 1800, speedLimitKph: 40, name: 'Residency Road' },
  { from: 'J3', to: 'J7', distanceM: 1300, speedLimitKph: 45, name: 'Kasturba Cross' },
];

export function testSegments(): RoadSegment[] {
  const junctions = new Map(testJunctions().map((junction) => [junction.id, junction]));
  const segments: RoadSegment[] = [];

  for (const link of LINKS) {
    const from = junctions.get(link.from)!;
    const to = junctions.get(link.to)!;
    // Bidirectional roads: two directed segments per link.
    for (const [a, b, suffix] of [
      [from, to, 'F'],
      [to, from, 'R'],
    ] as const) {
      segments.push({
        id: `${link.from}-${link.to}-${suffix}`,
        fromJunctionId: a.id,
        toJunctionId: b.id,
        distanceM: link.distanceM,
        speedLimitKph: link.speedLimitKph,
        traffic: link.traffic ?? TrafficLevel.NORMAL,
        name: link.name,
        path: [a.position, b.position],
        blocked: false,
        lanes: 2,
      });
    }
  }
  return segments;
}
