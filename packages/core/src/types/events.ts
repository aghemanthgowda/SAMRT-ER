import type {
  Conflict,
  Corridor,
  EmergencyRequest,
  HardwareDevice,
  Incident,
  Junction,
  JunctionAllocation,
  Notification,
  PublicTrafficImpact,
  RoadSegment,
  Route,
  SignalAcknowledgement,
  SignalCommand,
  SimulationState,
  TimelineEvent,
  VehicleState,
} from './domain.js';

/**
 * The realtime contract between the SMART-ER server and every dashboard.
 *
 * One socket channel carries all operational state. Clients subscribe on
 * connect, receive a `state.snapshot`, then apply deltas. There is no polling
 * and no page refresh anywhere in the product.
 */
export interface ServerToClientEvents {
  'state.snapshot': (snapshot: OperationalSnapshot) => void;

  'vehicle.state': (state: VehicleState) => void;
  'vehicle.states': (states: VehicleState[]) => void;

  'request.created': (request: EmergencyRequest) => void;
  'request.updated': (request: EmergencyRequest) => void;

  'route.created': (route: Route) => void;
  'route.updated': (route: Route) => void;

  'corridor.created': (corridor: Corridor) => void;
  'corridor.updated': (corridor: Corridor) => void;
  'corridor.released': (payload: { corridorId: string; vehicleId: string }) => void;

  'junction.updated': (payload: { junction: Junction; allocation?: JunctionAllocation }) => void;
  'junction.states': (payload: JunctionRuntimeState[]) => void;

  'conflict.detected': (conflict: Conflict) => void;
  'conflict.resolved': (conflict: Conflict) => void;

  'signal.command': (command: SignalCommand) => void;
  'signal.ack': (ack: SignalAcknowledgement) => void;

  'incident.created': (incident: Incident) => void;
  'incident.updated': (incident: Incident) => void;

  'notification.created': (notification: Notification) => void;
  'timeline.event': (event: TimelineEvent) => void;

  'traffic.updated': (segments: RoadSegment[]) => void;
  'impact.updated': (impact: PublicTrafficImpact) => void;
  'hardware.updated': (devices: HardwareDevice[]) => void;
  'simulation.updated': (state: SimulationState) => void;
}

export interface ClientToServerEvents {
  /** Join the rooms relevant to the authenticated role. */
  subscribe: (payload: { topics?: string[] }, ack?: (ok: boolean) => void) => void;
  /** Driver handsets push position when the browser Geolocation API is in use. */
  'driver.position': (payload: { lat: number; lng: number; heading?: number; speedKph?: number; accuracy?: number }) => void;
}

/** Junction state as broadcast to dashboards — the entity plus its live status. */
export interface JunctionRuntimeState {
  junctionId: string;
  code: string;
  state: import('./enums.js').JunctionState;
  aspect: import('./enums.js').SignalAspect;
  deviceStatus: import('./enums.js').DeviceStatus;
  /** Vehicle currently holding or about to hold the junction. */
  heldForVehicleId?: string;
  corridorId?: string;
  /** Seconds until the reservation window opens (negative once open). */
  secondsUntilActivation?: number;
  lastAckAt?: string;
  lastLatencyMs?: number;
}

/** Everything a dashboard needs to render on first paint. */
export interface OperationalSnapshot {
  serverTime: string;
  vehicles: VehicleState[];
  requests: EmergencyRequest[];
  routes: Route[];
  corridors: Corridor[];
  conflicts: Conflict[];
  incidents: Incident[];
  junctions: Junction[];
  junctionStates: JunctionRuntimeState[];
  roadSegments: RoadSegment[];
  devices: HardwareDevice[];
  impact: PublicTrafficImpact;
  timeline: TimelineEvent[];
  notifications: Notification[];
  simulation: SimulationState;
}
