import type {
  ConflictStatus,
  CorridorStatus,
  DestinationKind,
  DeviceKind,
  DeviceStatus,
  HardwareMode,
  ImpactLevel,
  IncidentKind,
  IncidentStatus,
  JunctionState,
  RequestStatus,
  ResolutionStrategy,
  Role,
  RouteChoiceReason,
  RouteSource,
  Severity,
  SignalAspect,
  TrafficLevel,
  VehicleKind,
  VehicleStatus,
} from './enums.js';

/** WGS-84 coordinate. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** ISO-8601 timestamp string. Used everywhere on the wire. */
export type Timestamp = string;

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  /** Set for CONTROLLER / ADMIN accounts. */
  callSign?: string;
  /** Set for HOSPITAL / FIRE_STATION / POLICE accounts — the facility they staff. */
  facilityId?: string;
  /** Set for DRIVER accounts. */
  driverId?: string;
  active: boolean;
  createdAt: Timestamp;
}

/**
 * An organization that operates emergency vehicles (private ambulance service,
 * municipal fire brigade, city police). Vehicles and drivers both belong to one.
 */
export interface Organization {
  id: string;
  name: string;
  kind: 'AMBULANCE_SERVICE' | 'FIRE_BRIGADE' | 'POLICE_DEPARTMENT';
  contactNumber: string;
  /** Government/municipal registration reference shown to the controller. */
  licenceNumber: string;
  active: boolean;
}

export interface Driver {
  id: string;
  userId: string;
  name: string;
  /** Emergency-vehicle operator licence number. */
  licenceNumber: string;
  licenceExpiry: Timestamp;
  organizationId: string;
  /** Vehicles this driver is authorised to operate. */
  authorizedVehicleIds: string[];
  phone: string;
  photoUrl?: string;
  active: boolean;
}

/**
 * A registered emergency vehicle.
 *
 * The identity chain a controller verifies before granting a corridor is:
 *   Driver → Vehicle → Organization → HardwareDevice
 * Every link must be present, active and mutually consistent.
 */
export interface Vehicle {
  id: string;
  /** Operational call sign, e.g. AMB-01. */
  callSign: string;
  kind: VehicleKind;
  registrationNumber: string;
  organizationId: string;
  /** Registered telemetry unit. In Phase 1 this is a simulated device. */
  hardwareDeviceId: string;
  /** Facility the vehicle is normally stationed at. */
  baseFacilityId: string;
  /** Free-flow cruising speed used for ETA when no live traffic data exists (km/h). */
  cruisingSpeedKph: number;
  active: boolean;
}

/** Live vehicle state, updated from telemetry every tick. */
export interface VehicleState {
  vehicleId: string;
  status: VehicleStatus;
  position: LatLng;
  /** Degrees clockwise from true north. */
  heading: number;
  speedKph: number;
  gpsOk: boolean;
  /** Metres — reported GPS accuracy; large values degrade corridor confidence. */
  gpsAccuracy: number;
  driverId?: string;
  activeRequestId?: string;
  activeRouteId?: string;
  corridorId?: string;
  /** Junction the vehicle is currently approaching, if on a corridor. */
  nextJunctionId?: string;
  /** Seconds until arrival at the destination. */
  etaSeconds?: number;
  /** Metres remaining along the active route. */
  distanceRemainingM?: number;
  updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

export interface Facility {
  id: string;
  name: string;
  kind: DestinationKind;
  position: LatLng;
  address: string;
  contactNumber: string;
  /** Hospitals: emergency bays. Fire/Police: available units. */
  capacity?: number;
  /** Hospitals only — trauma / cardiac / burns etc. */
  specialities?: string[];
}

export interface Destination {
  id: string;
  kind: DestinationKind;
  name: string;
  position: LatLng;
  /** Set when the destination is a registered facility rather than a map point. */
  facilityId?: string;
  /** Set when the destination is an incident scene. */
  incidentId?: string;
}

// ---------------------------------------------------------------------------
// Road network
// ---------------------------------------------------------------------------

export interface Junction {
  id: string;
  /** Short operational label, e.g. J2. */
  code: string;
  name: string;
  position: LatLng;
  /** Junction controller device that drives the physical signal heads. */
  hardwareDeviceId: string;
  /** Approach roads, used by the safety validator to reject conflicting greens. */
  approaches: JunctionApproach[];
  /** Seconds of all-red clearance required between conflicting movements. */
  clearanceSeconds: number;
  /** Typical vehicles per hour through the junction — drives public impact math. */
  averageThroughputVph: number;
}

export interface JunctionApproach {
  id: string;
  /** Compass bearing of traffic entering the junction on this approach. */
  bearing: number;
  name: string;
  /** Approach ids whose green would physically conflict with this one. */
  conflictsWith: string[];
}

/** A directed road link between two junctions. */
export interface RoadSegment {
  id: string;
  fromJunctionId: string;
  toJunctionId: string;
  distanceM: number;
  /** Posted limit (km/h). */
  speedLimitKph: number;
  /** Live traffic condition; simulated in Phase 1, Google-derived where available. */
  traffic: TrafficLevel;
  name: string;
  /** Shape points for drawing; endpoints included. */
  path: LatLng[];
  /** Set when a road is closed by an incident or works. */
  blocked: boolean;
  /** Lane count — used for public-impact estimation. */
  lanes: number;
}

// ---------------------------------------------------------------------------
// Emergency lifecycle
// ---------------------------------------------------------------------------

export interface EmergencyRequest {
  id: string;
  vehicleId: string;
  driverId: string;
  organizationId: string;
  severity: Severity;
  status: RequestStatus;
  origin: LatLng;
  destination: Destination;
  /** Free-text note from the driver, e.g. "cardiac arrest, 62M". */
  note?: string;
  incidentId?: string;
  createdAt: Timestamp;
  decidedAt?: Timestamp;
  decidedByUserId?: string;
  rejectionReason?: string;
  /** Snapshot of the identity chain the controller verified at approval time. */
  verification?: VehicleVerification;
  routeId?: string;
  corridorId?: string;
  completedAt?: Timestamp;
}

/** Result of checking Driver → Vehicle → Organization → HardwareDevice. */
export interface VehicleVerification {
  verified: boolean;
  checkedAt: Timestamp;
  driverAuthorized: boolean;
  driverLicenceValid: boolean;
  vehicleActive: boolean;
  organizationActive: boolean;
  hardwareRegistered: boolean;
  hardwareOnline: boolean;
  failures: string[];
}

export interface Incident {
  id: string;
  code: string;
  kind: IncidentKind;
  severity: Severity;
  status: IncidentStatus;
  position: LatLng;
  address: string;
  description: string;
  reportedAt: Timestamp;
  reportedByUserId?: string;
  /** Facility that owns the response (fire station / police HQ). */
  ownerFacilityId?: string;
  assignedVehicleIds: string[];
  resolvedAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface RouteSegmentRef {
  roadSegmentId: string;
  fromJunctionId: string;
  toJunctionId: string;
  distanceM: number;
  /** Traffic-aware travel time for this link at planning time. */
  travelTimeSeconds: number;
  traffic: TrafficLevel;
}

export interface RouteCandidate {
  id: string;
  /** Ordered junction ids from origin-adjacent to destination-adjacent. */
  junctionIds: string[];
  segments: RouteSegmentRef[];
  distanceM: number;
  /** Traffic-aware estimate — this, not distance, is what SMART-ER optimises. */
  etaSeconds: number;
  /** Drawable geometry. Google polyline where available, graph shape otherwise. */
  path: LatLng[];
  source: RouteSource;
  /** Junctions already reserved by a higher-priority corridor. */
  conflictingJunctionIds: string[];
  /** Estimated public delay in vehicle-seconds if this route gets a corridor. */
  publicImpactScore: number;
  /** Composite cost used for selection; lower is better. */
  cost: number;
  /** Human-readable label shown in the route comparison panel. */
  label: string;
}

export interface Route {
  id: string;
  requestId: string;
  vehicleId: string;
  origin: LatLng;
  destination: Destination;
  junctionIds: string[];
  segments: RouteSegmentRef[];
  path: LatLng[];
  distanceM: number;
  etaSeconds: number;
  source: RouteSource;
  /** Why this candidate was selected over the alternatives. */
  reason: RouteChoiceReason;
  /** The candidates that were compared, kept for the decision-explanation panel. */
  alternatives: RouteCandidate[];
  /** Prose explanation rendered verbatim in the controller UI. */
  explanation: string;
  createdAt: Timestamp;
  supersedesRouteId?: string;
  active: boolean;
  /** Index of the next un-passed junction in `junctionIds`. */
  progressIndex: number;
}

// ---------------------------------------------------------------------------
// Corridor & junction scheduling
// ---------------------------------------------------------------------------

/** A reservation of one junction for one vehicle over a time window. */
export interface JunctionAllocation {
  id: string;
  junctionId: string;
  corridorId: string;
  vehicleId: string;
  /** Approach the emergency vehicle enters on — the movement to hold green. */
  approachId: string;
  /** Priority of the owning vehicle, copied for fast comparison. */
  priority: number;
  /** Planned window during which the junction is held for this vehicle. */
  startsAt: Timestamp;
  endsAt: Timestamp;
  state: JunctionState;
  /** True when the window was shifted to de-conflict with another vehicle. */
  timeSlotted: boolean;
  releasedAt?: Timestamp;
}

export interface Corridor {
  id: string;
  requestId: string;
  vehicleId: string;
  routeId: string;
  status: CorridorStatus;
  /** Full ordered junction list of the route. */
  junctionIds: string[];
  allocations: JunctionAllocation[];
  /**
   * Rolling window: only these junctions are actively reserved right now.
   * Everything ahead stays NORMAL until the vehicle gets close enough.
   */
  activeJunctionId?: string;
  preparingJunctionIds: string[];
  releasedJunctionIds: string[];
  createdAt: Timestamp;
  releasedAt?: Timestamp;
}

export interface Conflict {
  id: string;
  junctionId: string;
  /** Vehicle that holds (or would hold) the junction first. */
  primaryVehicleId: string;
  secondaryVehicleId: string;
  primaryEta: Timestamp;
  secondaryEta: Timestamp;
  /** Seconds between the two arrivals — negative means overlap. */
  headwaySeconds: number;
  status: ConflictStatus;
  strategy?: ResolutionStrategy;
  /** Prose rendered in the conflict-explanation panel. */
  explanation: string;
  /** Populated when the resolution rerouted a vehicle. */
  reroutedVehicleId?: string;
  originalEtaSeconds?: number;
  newEtaSeconds?: number;
  timeSavedSeconds?: number;
  detectedAt: Timestamp;
  resolvedAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export interface SignalCommand {
  id: string;
  junctionId: string;
  deviceId: string;
  approachId: string;
  aspect: SignalAspect;
  /** How long to hold the aspect. */
  holdSeconds: number;
  corridorId?: string;
  vehicleId?: string;
  issuedAt: Timestamp;
  /** Set by the safety validator; a command is never dispatched without it. */
  safetyApproved: boolean;
  safetyNotes: string[];
}

export interface SignalAcknowledgement {
  commandId: string;
  junctionId: string;
  deviceId: string;
  accepted: boolean;
  /** Aspect the controller reports it actually displayed. */
  appliedAspect: SignalAspect;
  latencyMs: number;
  receivedAt: Timestamp;
  error?: string;
}

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------

export interface HardwareDevice {
  id: string;
  kind: DeviceKind;
  /** Stable hardware identity, e.g. HW-AMB-01. Matches the firmware's device id. */
  serial: string;
  mode: HardwareMode;
  status: DeviceStatus;
  firmwareVersion: string;
  /** Junction or vehicle this device is bound to. */
  boundEntityId?: string;
  lastHeartbeatAt?: Timestamp;
  /** Round-trip latency of the last acknowledged command. */
  lastLatencyMs?: number;
  signalStrength?: number;
}

// ---------------------------------------------------------------------------
// Impact, notifications, timeline
// ---------------------------------------------------------------------------

export interface PublicTrafficImpact {
  activeEmergencyJunctions: number;
  totalJunctions: number;
  /** Mean additional delay per affected public vehicle, in seconds. */
  estimatedAdditionalDelaySeconds: number;
  /** Total delay across all affected public vehicles, in vehicle-seconds. */
  totalVehicleSecondsLost: number;
  level: ImpactLevel;
  affectedJunctionIds: string[];
}

export interface Notification {
  id: string;
  /** Facility, user or role the notification is addressed to. */
  audience: { facilityId?: string; userId?: string; role?: Role };
  title: string;
  body: string;
  severity: Severity;
  requestId?: string;
  vehicleId?: string;
  incidentId?: string;
  createdAt: Timestamp;
  readAt?: Timestamp;
}

/** One line in the incident timeline. */
export interface TimelineEvent {
  id: string;
  at: Timestamp;
  /** Machine-readable event key, e.g. `corridor.junction.released`. */
  kind: string;
  message: string;
  requestId?: string;
  vehicleId?: string;
  junctionId?: string;
  corridorId?: string;
  incidentId?: string;
  severity?: Severity;
  /** Extra structured detail for the decision-explanation panel. */
  data?: Record<string, unknown>;
}

export interface SimulationScenario {
  id: string;
  name: string;
  description: string;
  /** Ordered steps executed by the scenario runner. */
  steps: SimulationStep[];
  /** What the operator should watch for — rendered next to the Start button. */
  expectedOutcome: string;
}

export type SimulationStep =
  | { at: number; action: 'SIGN_ON'; vehicleId: string; driverId: string }
  | {
      at: number;
      action: 'REQUEST';
      vehicleId: string;
      destinationFacilityId?: string;
      destinationIncidentId?: string;
      severity: Severity;
      note?: string;
    }
  | { at: number; action: 'APPROVE'; vehicleCallSign: string }
  | { at: number; action: 'REPORT_INCIDENT'; incidentId: string }
  | { at: number; action: 'SET_TRAFFIC'; roadSegmentId: string; traffic: TrafficLevel }
  | { at: number; action: 'BLOCK_ROAD'; roadSegmentId: string; blocked: boolean }
  | { at: number; action: 'GPS_FAILURE'; vehicleId: string; failed: boolean }
  | { at: number; action: 'DEVICE_OFFLINE'; deviceId: string; offline: boolean };

export interface SimulationState {
  running: boolean;
  /** Seconds of simulated time elapsed since the scenario started. */
  elapsedSeconds: number;
  speed: number;
  scenarioId?: string;
  scenarioName?: string;
  /** Index of the next step to fire. */
  stepIndex: number;
  startedAt?: Timestamp;
}
