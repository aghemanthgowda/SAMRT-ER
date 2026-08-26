import type { Junction, JunctionApproach, LatLng, RoadSegment } from '@smart-er/core';
import { TrafficLevel } from '@smart-er/core';

/**
 * The SMART-ER junction network.
 *
 * Coordinates are real central-Bengaluru intersections, so the network sits
 * correctly on Google Maps and the routes it produces follow roads that exist.
 * Road distances are the actual carriageway lengths rather than straight-line
 * distances, which is why they do not match the geodesic distance between the
 * junction coordinates.
 *
 * When a Google Maps key is configured the browser replaces each route's
 * geometry with the real Routes API polyline; this table remains the model the
 * corridor scheduler reasons about, because a corridor is a reservation over
 * *these* nodes.
 */

interface JunctionSpec {
  code: string;
  name: string;
  position: LatLng;
  /** Vehicles per hour through the junction, all approaches combined. */
  throughput: number;
  clearanceSeconds?: number;
  /** Bearing of traffic entering on each approach, with a readable name. */
  approaches: { suffix: string; bearing: number; name: string }[];
}

/** Standard four-way: opposing approaches run together, crossing ones conflict. */
function crossroads(names: [string, string, string, string]) {
  return [
    { suffix: 'N', bearing: 180, name: names[0] },
    { suffix: 'E', bearing: 270, name: names[1] },
    { suffix: 'S', bearing: 0, name: names[2] },
    { suffix: 'W', bearing: 90, name: names[3] },
  ];
}

const JUNCTION_SPECS: JunctionSpec[] = [
  {
    code: 'J1',
    name: 'Trinity Circle',
    position: { lat: 12.97245, lng: 77.61686 },
    throughput: 4200,
    approaches: crossroads(['Old Airport Road', 'Dickenson Road', 'MG Road east', 'Manipal Centre']),
  },
  {
    code: 'J2',
    name: 'MG Road / Brigade Road',
    position: { lat: 12.97463, lng: 77.60946 },
    throughput: 5600,
    clearanceSeconds: 8,
    approaches: crossroads(['MG Road east', 'Brigade Road south', 'MG Road west', 'Church Street']),
  },
  {
    code: 'J3',
    name: 'Anil Kumble Circle',
    position: { lat: 12.97576, lng: 77.60357 },
    throughput: 4800,
    approaches: crossroads(['MG Road east', 'St Marks Road', 'Cubbon Road', 'Kasturba Road']),
  },
  {
    code: 'J4',
    name: 'Richmond Circle',
    position: { lat: 12.96144, lng: 77.59667 },
    throughput: 5100,
    clearanceSeconds: 8,
    approaches: crossroads(['Richmond Road', 'Hosur Road', 'Langford Road', 'Double Road']),
  },
  {
    code: 'J5',
    name: 'Corporation Circle',
    position: { lat: 12.96731, lng: 77.59054 },
    throughput: 4600,
    approaches: crossroads(['NR Square', 'Mission Road', 'JC Road', 'Kempegowda Road']),
  },
  {
    code: 'J6',
    name: 'Double Road Junction',
    position: { lat: 12.96395, lng: 77.60417 },
    throughput: 3400,
    approaches: crossroads(['Residency Road', 'Double Road north', 'Richmond Road', 'Double Road south']),
  },
  {
    code: 'J7',
    name: 'Hudson Circle',
    position: { lat: 12.96706, lng: 77.59531 },
    throughput: 3900,
    approaches: crossroads(['Kasturba Road', 'Nrupathunga Road', 'JC Road', 'Mission Road']),
  },
  {
    code: 'J8',
    name: 'Cubbon Park North',
    position: { lat: 12.97878, lng: 77.59539 },
    throughput: 3100,
    approaches: crossroads(['Raj Bhavan Road', 'Cubbon Road', 'Ambedkar Veedhi', 'Post Office Road']),
  },
  {
    code: 'J9',
    name: 'Residency Road / Richmond',
    position: { lat: 12.96682, lng: 77.60189 },
    throughput: 3600,
    approaches: crossroads(['Residency Road east', 'Rest House Road', 'Residency Road west', 'Castle Street']),
  },
  {
    code: 'J10',
    name: 'Shivajinagar',
    position: { lat: 12.98387, lng: 77.60524 },
    throughput: 4400,
    approaches: crossroads(['Queens Road', 'Cunningham Road', 'Infantry Road', 'Millers Road']),
  },
  {
    code: 'J11',
    name: 'Queens Road / Cubbon',
    position: { lat: 12.98003, lng: 77.60104 },
    throughput: 3300,
    approaches: crossroads(['Queens Road north', 'Cubbon Road east', 'Queens Road south', 'Raj Bhavan Road']),
  },
  {
    code: 'J12',
    name: 'Lalbagh West Gate',
    position: { lat: 12.95459, lng: 77.58419 },
    throughput: 3700,
    approaches: crossroads(['Krishna Rao Road', 'Lalbagh Road', 'Siddapura Road', 'Ashoka Pillar Road']),
  },
  {
    code: 'J13',
    name: 'Wilson Garden',
    position: { lat: 12.95126, lng: 77.59672 },
    throughput: 2900,
    approaches: crossroads(['Hosur Road', 'Wilson Garden 9th Cross', 'Lalbagh Road', 'Sudhama Nagar']),
  },
  {
    code: 'J14',
    name: 'Ulsoor Lake',
    position: { lat: 12.98126, lng: 77.61887 },
    throughput: 3200,
    approaches: crossroads(['Ulsoor Road', 'Kensington Road', 'Assaye Road', 'Gangadhar Chetty Road']),
  },
];

export function buildJunctions(): Junction[] {
  return JUNCTION_SPECS.map((spec) => {
    const approaches: JunctionApproach[] = spec.approaches.map((approach) => ({
      id: `${spec.code}-${approach.suffix}`,
      bearing: approach.bearing,
      name: approach.name,
      conflictsWith: [],
    }));

    // Opposing approaches (N/S, E/W) may run together; crossing ones may not.
    const opposite: Record<string, string> = { N: 'S', S: 'N', E: 'W', W: 'E' };
    for (const approach of approaches) {
      const suffix = approach.id.split('-')[1]!;
      approach.conflictsWith = approaches
        .filter((other) => {
          const otherSuffix = other.id.split('-')[1]!;
          return otherSuffix !== suffix && otherSuffix !== opposite[suffix];
        })
        .map((other) => other.id);
    }

    return {
      id: spec.code,
      code: spec.code,
      name: spec.name,
      position: spec.position,
      hardwareDeviceId: `HW-${spec.code}`,
      approaches,
      clearanceSeconds: spec.clearanceSeconds ?? 6,
      averageThroughputVph: spec.throughput,
    };
  });
}

interface LinkSpec {
  from: string;
  to: string;
  /** Carriageway length in metres. */
  distanceM: number;
  speedLimitKph: number;
  name: string;
  lanes: number;
  traffic?: TrafficLevel;
  /** Intermediate shape points, so the drawn road is not a straight line. */
  via?: LatLng[];
}

const LINK_SPECS: LinkSpec[] = [
  { from: 'J1', to: 'J2', distanceM: 1000, speedLimitKph: 40, name: 'MG Road', lanes: 3, via: [{ lat: 12.97527, lng: 77.61335 }] },
  { from: 'J2', to: 'J3', distanceM: 680, speedLimitKph: 40, name: 'MG Road west', lanes: 3 },
  { from: 'J3', to: 'J8', distanceM: 1050, speedLimitKph: 45, name: 'Cubbon Road', lanes: 2, via: [{ lat: 12.97783, lng: 77.59936 }] },
  { from: 'J8', to: 'J5', distanceM: 1520, speedLimitKph: 40, name: 'Ambedkar Veedhi', lanes: 3, via: [{ lat: 12.97361, lng: 77.59225 }] },
  { from: 'J3', to: 'J7', distanceM: 1480, speedLimitKph: 45, name: 'Kasturba Road', lanes: 2, via: [{ lat: 12.97188, lng: 77.59742 }] },
  { from: 'J7', to: 'J5', distanceM: 620, speedLimitKph: 40, name: 'Nrupathunga Road', lanes: 2 },
  { from: 'J2', to: 'J9', distanceM: 1330, speedLimitKph: 40, name: 'Brigade Road', lanes: 2, via: [{ lat: 12.97121, lng: 77.60686 }] },
  { from: 'J9', to: 'J4', distanceM: 900, speedLimitKph: 45, name: 'Residency Road', lanes: 3, via: [{ lat: 12.96438, lng: 77.59932 }] },
  { from: 'J9', to: 'J6', distanceM: 480, speedLimitKph: 40, name: 'Rest House Road', lanes: 2 },
  { from: 'J6', to: 'J4', distanceM: 950, speedLimitKph: 45, name: 'Richmond Road', lanes: 2 },
  { from: 'J4', to: 'J7', distanceM: 780, speedLimitKph: 45, name: 'Mission Road', lanes: 2, via: [{ lat: 12.96401, lng: 77.59575 }] },
  { from: 'J4', to: 'J13', distanceM: 1250, speedLimitKph: 50, name: 'Hosur Road', lanes: 4, via: [{ lat: 12.95632, lng: 77.59668 }] },
  { from: 'J13', to: 'J12', distanceM: 1500, speedLimitKph: 45, name: 'Lalbagh Road', lanes: 2, via: [{ lat: 12.95245, lng: 77.59022 }] },
  { from: 'J12', to: 'J5', distanceM: 1740, speedLimitKph: 45, name: 'KR Road', lanes: 3, via: [{ lat: 12.96058, lng: 77.58627 }] },
  { from: 'J10', to: 'J11', distanceM: 700, speedLimitKph: 40, name: 'Queens Road', lanes: 2 },
  { from: 'J11', to: 'J8', distanceM: 640, speedLimitKph: 40, name: 'Raj Bhavan Road', lanes: 2 },
  { from: 'J11', to: 'J3', distanceM: 640, speedLimitKph: 40, name: 'Cubbon Road east', lanes: 2 },
  { from: 'J10', to: 'J14', distanceM: 1600, speedLimitKph: 45, name: 'Infantry Road', lanes: 2, via: [{ lat: 12.98322, lng: 77.61265 }] },
  { from: 'J14', to: 'J1', distanceM: 1050, speedLimitKph: 40, name: 'Gangadhar Chetty Road', lanes: 2 },
  { from: 'J1', to: 'J9', distanceM: 1900, speedLimitKph: 40, name: 'Castle Street link', lanes: 2, via: [{ lat: 12.96975, lng: 77.61103 }] },
  { from: 'J6', to: 'J13', distanceM: 1780, speedLimitKph: 40, name: 'Double Road south', lanes: 2, via: [{ lat: 12.95741, lng: 77.60063 }] },
  { from: 'J2', to: 'J10', distanceM: 1300, speedLimitKph: 40, name: 'Millers Road link', lanes: 2, via: [{ lat: 12.98014, lng: 77.60765 }] },
];

export function buildRoadSegments(junctions: readonly Junction[]): RoadSegment[] {
  const byId = new Map(junctions.map((junction) => [junction.id, junction]));
  const segments: RoadSegment[] = [];

  for (const link of LINK_SPECS) {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) {
      throw new Error(`network: link ${link.from}→${link.to} references an unknown junction`);
    }

    const forwardPath = [from.position, ...(link.via ?? []), to.position];
    // Every road is two-way; the network models each direction separately so
    // one carriageway can be blocked or congested without the other.
    segments.push({
      id: `${link.from}-${link.to}`,
      fromJunctionId: from.id,
      toJunctionId: to.id,
      distanceM: link.distanceM,
      speedLimitKph: link.speedLimitKph,
      traffic: link.traffic ?? TrafficLevel.NORMAL,
      name: link.name,
      path: forwardPath,
      blocked: false,
      lanes: link.lanes,
    });
    segments.push({
      id: `${link.to}-${link.from}`,
      fromJunctionId: to.id,
      toJunctionId: from.id,
      distanceM: link.distanceM,
      speedLimitKph: link.speedLimitKph,
      traffic: link.traffic ?? TrafficLevel.NORMAL,
      name: link.name,
      path: [...forwardPath].reverse(),
      blocked: false,
      lanes: link.lanes,
    });
  }

  return segments;
}
