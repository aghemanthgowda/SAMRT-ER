/**
 * Enumerated domain vocabulary shared by every layer of SMART-ER.
 *
 * These are declared as const objects rather than TypeScript `enum`s so the
 * values survive `isolatedModules` transpilation unchanged and can be sent
 * over the wire, persisted, and compared without a runtime import.
 */

export const Role = {
  DRIVER: 'DRIVER',
  CONTROLLER: 'CONTROLLER',
  HOSPITAL: 'HOSPITAL',
  FIRE_STATION: 'FIRE_STATION',
  POLICE: 'POLICE',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const VehicleKind = {
  AMBULANCE: 'AMBULANCE',
  FIRE_TRUCK: 'FIRE_TRUCK',
  POLICE_UNIT: 'POLICE_UNIT',
} as const;
export type VehicleKind = (typeof VehicleKind)[keyof typeof VehicleKind];

export const VehicleStatus = {
  /** Parked at base, no driver signed on. */
  OFFLINE: 'OFFLINE',
  /** Driver signed on and vehicle verified, awaiting assignment. */
  STANDBY: 'STANDBY',
  /** Emergency request submitted, awaiting controller approval. */
  REQUESTED: 'REQUESTED',
  /** Approved and moving along an active route. */
  ACTIVE: 'ACTIVE',
  /** Actively being moved onto a different route. */
  REROUTING: 'REROUTING',
  /** Reached the destination, awaiting confirmation. */
  ARRIVED: 'ARRIVED',
  /** Incident closed out. */
  COMPLETED: 'COMPLETED',
} as const;
export type VehicleStatus = (typeof VehicleStatus)[keyof typeof VehicleStatus];

/**
 * Clinical / operational urgency selected by the driver or dispatcher.
 * Drives the numeric priority score used by the conflict engine.
 */
export const Severity = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

export const RequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;
export type RequestStatus = (typeof RequestStatus)[keyof typeof RequestStatus];

/**
 * Junction state within a rolling green corridor.
 *
 * NORMAL    → junction runs its own public traffic programme
 * PREPARING → corridor has reserved it; signal is being cleared ahead of arrival
 * GREEN     → emergency movement is held green
 * RELEASED  → emergency vehicle has passed; junction is handing back to public traffic
 * CONFLICT  → two or more emergency movements contend for this junction
 * OFFLINE   → controller unreachable (watchdog expired)
 */
export const JunctionState = {
  NORMAL: 'NORMAL',
  PREPARING: 'PREPARING',
  GREEN: 'GREEN',
  RELEASED: 'RELEASED',
  CONFLICT: 'CONFLICT',
  OFFLINE: 'OFFLINE',
} as const;
export type JunctionState = (typeof JunctionState)[keyof typeof JunctionState];

export const SignalAspect = {
  RED: 'RED',
  AMBER: 'AMBER',
  GREEN: 'GREEN',
  /** All-red clearance interval between conflicting movements. */
  ALL_RED: 'ALL_RED',
  /** Junction has failed safe. */
  FLASHING_RED: 'FLASHING_RED',
} as const;
export type SignalAspect = (typeof SignalAspect)[keyof typeof SignalAspect];

export const CorridorStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  RELEASED: 'RELEASED',
} as const;
export type CorridorStatus = (typeof CorridorStatus)[keyof typeof CorridorStatus];

export const ConflictStatus = {
  DETECTED: 'DETECTED',
  RESOLVED_REROUTE: 'RESOLVED_REROUTE',
  RESOLVED_TIME_SLOT: 'RESOLVED_TIME_SLOT',
  RESOLVED_PRIORITY_HOLD: 'RESOLVED_PRIORITY_HOLD',
  UNRESOLVED: 'UNRESOLVED',
} as const;
export type ConflictStatus = (typeof ConflictStatus)[keyof typeof ConflictStatus];

export const ResolutionStrategy = {
  /** A lower-priority vehicle was moved onto a conflict-free alternative. */
  REROUTE: 'REROUTE',
  /** Both vehicles keep their route; the junction is time-sliced between them. */
  TIME_SLOT: 'TIME_SLOT',
  /** No alternative and no slack: the lower-priority vehicle waits. */
  PRIORITY_HOLD: 'PRIORITY_HOLD',
  /** Contention disappeared before a decision was needed. */
  NO_ACTION: 'NO_ACTION',
} as const;
export type ResolutionStrategy = (typeof ResolutionStrategy)[keyof typeof ResolutionStrategy];

export const IncidentKind = {
  MEDICAL: 'MEDICAL',
  FIRE: 'FIRE',
  LAW_ENFORCEMENT: 'LAW_ENFORCEMENT',
  ROAD_ACCIDENT: 'ROAD_ACCIDENT',
} as const;
export type IncidentKind = (typeof IncidentKind)[keyof typeof IncidentKind];

export const IncidentStatus = {
  REPORTED: 'REPORTED',
  DISPATCHED: 'DISPATCHED',
  ON_SCENE: 'ON_SCENE',
  RESOLVED: 'RESOLVED',
} as const;
export type IncidentStatus = (typeof IncidentStatus)[keyof typeof IncidentStatus];

export const DestinationKind = {
  HOSPITAL: 'HOSPITAL',
  FIRE_STATION: 'FIRE_STATION',
  POLICE_HQ: 'POLICE_HQ',
  INCIDENT_SITE: 'INCIDENT_SITE',
} as const;
export type DestinationKind = (typeof DestinationKind)[keyof typeof DestinationKind];

export const TrafficLevel = {
  FREE_FLOW: 'FREE_FLOW',
  NORMAL: 'NORMAL',
  SLOW: 'SLOW',
  HEAVY: 'HEAVY',
  BLOCKED: 'BLOCKED',
} as const;
export type TrafficLevel = (typeof TrafficLevel)[keyof typeof TrafficLevel];

export const ImpactLevel = {
  NONE: 'NONE',
  LOW: 'LOW',
  MODERATE: 'MODERATE',
  HIGH: 'HIGH',
} as const;
export type ImpactLevel = (typeof ImpactLevel)[keyof typeof ImpactLevel];

export const DeviceKind = {
  VEHICLE_UNIT: 'VEHICLE_UNIT',
  JUNCTION_CONTROLLER: 'JUNCTION_CONTROLLER',
  EMERGENCY_BUTTON: 'EMERGENCY_BUTTON',
} as const;
export type DeviceKind = (typeof DeviceKind)[keyof typeof DeviceKind];

export const DeviceStatus = {
  ONLINE: 'ONLINE',
  DEGRADED: 'DEGRADED',
  OFFLINE: 'OFFLINE',
} as const;
export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];

/**
 * Which implementation is currently behind the hardware abstraction layer.
 * Phase 1 runs entirely on SIMULATED; Phase 2 swaps individual devices to ESP32
 * without any change to the engines above this boundary.
 */
export const HardwareMode = {
  SIMULATED: 'SIMULATED',
  ESP32: 'ESP32',
} as const;
export type HardwareMode = (typeof HardwareMode)[keyof typeof HardwareMode];

/**
 * Whether a vehicle or junction is backed by real hardware or by the simulator.
 *
 * Distinct from HardwareMode, which describes the transport implementation.
 * This is the operational fact a controller needs: is the position on the map
 * a real GPS fix from a real vehicle, or a simulated track? During the hardware
 * demonstration the two will be on screen side by side, and the display must
 * not blur them together.
 */
export const Provisioning = {
  PHYSICAL: 'PHYSICAL',
  SIMULATED: 'SIMULATED',
} as const;
export type Provisioning = (typeof Provisioning)[keyof typeof Provisioning];

export const RouteChoiceReason = {
  FASTEST_SAFE: 'FASTEST_SAFE',
  CONFLICT_FREE_ALTERNATIVE: 'CONFLICT_FREE_ALTERNATIVE',
  ONLY_AVAILABLE: 'ONLY_AVAILABLE',
  REROUTED_TRAFFIC: 'REROUTED_TRAFFIC',
  REROUTED_JUNCTION_UNAVAILABLE: 'REROUTED_JUNCTION_UNAVAILABLE',
  REROUTED_ROAD_UNAVAILABLE: 'REROUTED_ROAD_UNAVAILABLE',
  REROUTED_DESTINATION_CHANGED: 'REROUTED_DESTINATION_CHANGED',
} as const;
export type RouteChoiceReason = (typeof RouteChoiceReason)[keyof typeof RouteChoiceReason];

export const RouteSource = {
  /** Computed on SMART-ER's own junction graph (no key / server-side). */
  GRAPH: 'GRAPH',
  /** Geometry and traffic-aware ETA supplied by the Google Maps Routes library. */
  GOOGLE_ROUTES: 'GOOGLE_ROUTES',
  /** Google Maps legacy DirectionsService fallback. */
  GOOGLE_DIRECTIONS: 'GOOGLE_DIRECTIONS',
} as const;
export type RouteSource = (typeof RouteSource)[keyof typeof RouteSource];
