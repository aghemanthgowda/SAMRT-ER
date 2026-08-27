import type {
  Conflict,
  Corridor,
  EmergencyRequest,
  Facility,
  Junction,
  JunctionRuntimeState,
  Route,
  Vehicle,
  VehicleState,
} from '@smart-er/core';
import {
  ConflictStatus,
  CorridorStatus,
  DestinationKind,
  DeviceStatus,
  JunctionState,
  Provisioning,
  RequestStatus,
  ResolutionStrategy,
  RouteChoiceReason,
  RouteSource,
  Severity,
  SignalAspect,
  TrafficLevel,
  VehicleKind,
  VehicleStatus,
} from '@smart-er/core';

/** Deterministic fixtures so component tests never depend on a live server. */

export const junction = (id: string, code = id): Junction => ({
  id,
  code,
  name: `${code} junction`,
  position: { lat: 12.9746, lng: 77.6094 },
  hardwareDeviceId: `HW-${id}`,
  provisioning: Provisioning.SIMULATED,
  clearanceSeconds: 6,
  averageThroughputVph: 4000,
  approaches: [
    { id: `${id}-N`, bearing: 180, name: 'North', conflictsWith: [`${id}-E`] },
    { id: `${id}-E`, bearing: 270, name: 'East', conflictsWith: [`${id}-N`] },
  ],
});

export const vehicle = (id: string, kind: VehicleKind = VehicleKind.AMBULANCE): Vehicle => ({
  id,
  callSign: id,
  kind,
  registrationNumber: 'KA 01 MA 0001',
  organizationId: 'ORG-001',
  hardwareDeviceId: `HW-${id}`,
  baseFacilityId: 'FAC-HOSP-01',
  standbyPosition: { lat: 12.9722, lng: 77.6167 },
  cruisingSpeedKph: 50,
  provisioning: Provisioning.SIMULATED,
  active: true,
});

export const vehicleState = (id: string, overrides: Partial<VehicleState> = {}): VehicleState => ({
  vehicleId: id,
  status: VehicleStatus.ACTIVE,
  position: { lat: 12.9746, lng: 77.6094 },
  heading: 90,
  speedKph: 46,
  gpsOk: true,
  gpsAccuracy: 6,
  etaSeconds: 342,
  distanceRemainingM: 2100,
  updatedAt: new Date().toISOString(),
  ...overrides,
});

export const facility = (id: string, name: string): Facility => ({
  id,
  name,
  kind: DestinationKind.HOSPITAL,
  position: { lat: 12.97668, lng: 77.59214 },
  address: 'Ambedkar Veedhi',
  contactNumber: '+91 80 2670 1000',
  capacity: 12,
  specialities: ['Trauma', 'Cardiac'],
});

export const request = (id: string, overrides: Partial<EmergencyRequest> = {}): EmergencyRequest => ({
  id,
  vehicleId: 'AMB-01',
  driverId: 'DRV-001',
  organizationId: 'ORG-001',
  severity: Severity.CRITICAL,
  status: RequestStatus.PENDING,
  origin: { lat: 12.9722, lng: 77.6167 },
  destination: {
    id: 'DST-FAC-HOSP-01',
    kind: DestinationKind.HOSPITAL,
    name: 'City General Hospital',
    position: { lat: 12.97668, lng: 77.59214 },
    facilityId: 'FAC-HOSP-01',
  },
  note: 'Cardiac arrest, 62M',
  createdAt: new Date().toISOString(),
  ...overrides,
});

export const route = (id: string, overrides: Partial<Route> = {}): Route => ({
  id,
  requestId: 'REQ-1',
  vehicleId: 'AMB-01',
  origin: { lat: 12.9722, lng: 77.6167 },
  destination: {
    id: 'DST-FAC-HOSP-01',
    kind: DestinationKind.HOSPITAL,
    name: 'City General Hospital',
    position: { lat: 12.97668, lng: 77.59214 },
    facilityId: 'FAC-HOSP-01',
  },
  junctionIds: ['J1', 'J2', 'J3'],
  segments: [
    {
      roadSegmentId: 'J1-J2',
      fromJunctionId: 'J1',
      toJunctionId: 'J2',
      distanceM: 1000,
      travelTimeSeconds: 92,
      traffic: TrafficLevel.NORMAL,
    },
  ],
  path: [
    { lat: 12.9722, lng: 77.6167 },
    { lat: 12.9746, lng: 77.6094 },
  ],
  distanceM: 6000,
  etaSeconds: 405,
  source: RouteSource.GRAPH,
  reason: RouteChoiceReason.FASTEST_SAFE,
  alternatives: [
    {
      id: 'RC-1',
      junctionIds: ['J1', 'J2', 'J3'],
      segments: [],
      distanceM: 6000,
      etaSeconds: 405,
      path: [],
      source: RouteSource.GRAPH,
      conflictingJunctionIds: [],
      publicImpactScore: 40,
      cost: 405,
      label: 'Fastest',
    },
    {
      // Shorter but slower — the case the comparison panel must make legible.
      id: 'RC-2',
      junctionIds: ['J1', 'J6', 'J3'],
      segments: [],
      distanceM: 5200,
      etaSeconds: 490,
      path: [],
      source: RouteSource.GRAPH,
      conflictingJunctionIds: ['J6'],
      publicImpactScore: 55,
      cost: 535,
      label: 'Alternative 1',
    },
  ],
  explanation: 'Selected fastest route via J1 → J2 → J3: 6.0 km, ETA 06:45.',
  createdAt: new Date().toISOString(),
  active: true,
  progressIndex: 0,
  ...overrides,
});

export const corridor = (id: string, overrides: Partial<Corridor> = {}): Corridor => ({
  id,
  requestId: 'REQ-1',
  vehicleId: 'AMB-01',
  routeId: 'RTE-1',
  status: CorridorStatus.ACTIVE,
  junctionIds: ['J1', 'J2', 'J3'],
  allocations: [
    allocation('ALC-1', id, 'J1', JunctionState.RELEASED, { releasedAt: new Date().toISOString() }),
    allocation('ALC-2', id, 'J2', JunctionState.GREEN),
    allocation('ALC-3', id, 'J3', JunctionState.PREPARING),
  ],
  activeJunctionId: 'J2',
  preparingJunctionIds: ['J3'],
  releasedJunctionIds: ['J1'],
  createdAt: new Date().toISOString(),
  ...overrides,
});

function allocation(
  id: string,
  corridorId: string,
  junctionId: string,
  state: JunctionState,
  overrides: Partial<Corridor['allocations'][number]> = {},
): Corridor['allocations'][number] {
  return {
    id,
    junctionId,
    corridorId,
    vehicleId: 'AMB-01',
    approachId: `${junctionId}-N`,
    priority: 120,
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 20000).toISOString(),
    state,
    timeSlotted: false,
    ...overrides,
  };
}

export const conflict = (id: string, overrides: Partial<Conflict> = {}): Conflict => ({
  id,
  junctionId: 'J2',
  primaryVehicleId: 'AMB-01',
  secondaryVehicleId: 'FIRE-01',
  primaryEta: new Date().toISOString(),
  secondaryEta: new Date(Date.now() + 5000).toISOString(),
  headwaySeconds: -9,
  status: ConflictStatus.RESOLVED_REROUTE,
  strategy: ResolutionStrategy.REROUTE,
  explanation:
    'J2 conflict: AMB-01 and FIRE-01 arrive 9 s too close together. A conflict-free alternative exists via J4 → J6 → J7 → J5. FIRE-01 rerouted.',
  reroutedVehicleId: 'FIRE-01',
  originalEtaSeconds: 340,
  newEtaSeconds: 315,
  timeSavedSeconds: 25,
  detectedAt: new Date().toISOString(),
  ...overrides,
});

export const junctionRuntime = (
  junctionId: string,
  state: JunctionState = JunctionState.NORMAL,
): JunctionRuntimeState => ({
  junctionId,
  code: junctionId,
  state,
  aspect: state === JunctionState.GREEN ? SignalAspect.GREEN : SignalAspect.RED,
  deviceStatus: DeviceStatus.ONLINE,
});
