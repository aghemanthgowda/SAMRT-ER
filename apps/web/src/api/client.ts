import type {
  Conflict,
  Corridor,
  Driver,
  EmergencyRequest,
  Facility,
  HardwareDevice,
  Incident,
  Junction,
  JunctionRuntimeState,
  LatLng,
  Notification,
  OperationalSnapshot,
  Organization,
  PublicTrafficImpact,
  RoadSegment,
  Route,
  Severity,
  SimulationScenario,
  SimulationState,
  TimelineEvent,
  User,
  Vehicle,
  VehicleState,
  VehicleVerification,
} from '@smart-er/core';

/** Same-origin in development (Vite proxies /api), configurable for deployment. */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let authToken: string | undefined;

export function setAuthToken(token: string | undefined): void {
  authToken = token;
}

export function getAuthToken(): string | undefined {
  return authToken;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body) headers.set('content-type', 'application/json');
  if (authToken) headers.set('authorization', `Bearer ${authToken}`);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/api${path}`, { ...init, headers });
  } catch {
    // A failed fetch is almost always the API being unreachable, and saying so
    // is far more useful to an operator than "Failed to fetch".
    throw new ApiError('Cannot reach the SMART-ER server. Check that it is running.', 0);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const body: unknown = text ? safeParse(text) : undefined;

  if (!response.ok) {
    const message =
      (body as { error?: string } | undefined)?.error ?? `Request failed with status ${response.status}.`;
    throw new ApiError(message, response.status, (body as { details?: unknown } | undefined)?.details);
  }
  return body as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const get = <T>(path: string) => call<T>(path);
const post = <T>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export interface LoginResult {
  token: string;
  expiresIn: string;
  user: User;
  driver?: Driver;
  vehicles: Vehicle[];
  facility?: Facility;
}

export interface VehicleWithState extends Vehicle {
  state?: VehicleState;
  organization?: Organization;
}

export interface VehicleIdentity {
  vehicle: Vehicle;
  organization?: Organization;
  device?: HardwareDevice;
  baseFacility?: Facility;
  authorizedDrivers: Driver[];
}

export interface RequestDetail {
  request: EmergencyRequest;
  route?: Route;
  corridor?: Corridor;
  identity?: VehicleIdentity;
  timeline: TimelineEvent[];
}

export interface JunctionDetail {
  junction: Junction;
  state?: JunctionRuntimeState;
  device?: HardwareDevice;
  aspects: Record<string, string>;
  allocations: Corridor['allocations'];
  recentCommands: { id: string; aspect: string; issuedAt: string; safetyApproved: boolean; safetyNotes: string[] }[];
}

export interface SubmitRequestBody {
  vehicleId: string;
  severity: Severity;
  destinationFacilityId?: string;
  destinationIncidentId?: string;
  destinationPoint?: LatLng & { name?: string };
  note?: string;
}

export const api = {
  // auth
  login: (email: string, password: string) => post<LoginResult>('/auth/login', { email, password }),
  me: () => get<{ user: User; driver?: Driver; vehicles: Vehicle[]; facility?: Facility }>('/auth/me'),
  demoAccounts: () =>
    get<{ password: string; accounts: { email: string; role: string; displayName: string; facility?: string; vehicles?: string[] }[] }>(
      '/auth/demo-accounts',
    ),

  // reference
  network: () => get<{ junctions: Junction[]; roadSegments: RoadSegment[]; junctionStates: JunctionRuntimeState[] }>('/network'),
  facilities: (kind?: string) => get<Facility[]>(`/facilities${kind ? `?kind=${kind}` : ''}`),
  vehicles: () => get<VehicleWithState[]>('/vehicles'),
  vehicleIdentity: (vehicleId: string) => get<VehicleIdentity>(`/vehicles/${vehicleId}/identity`),
  verifyVehicle: (vehicleId: string, driverId?: string) =>
    get<VehicleVerification>(`/vehicles/${vehicleId}/verify${driverId ? `?driverId=${driverId}` : ''}`),
  snapshot: () => get<OperationalSnapshot>('/snapshot'),

  // driver
  signOn: (vehicleId: string) => post<VehicleState>('/driver/sign-on', { vehicleId }),
  signOff: (vehicleId: string) => post<VehicleState>('/driver/sign-off', { vehicleId }),

  // requests
  requests: (status?: string) => get<EmergencyRequest[]>(`/requests${status ? `?status=${status}` : ''}`),
  request: (requestId: string) => get<RequestDetail>(`/requests/${requestId}`),
  submitRequest: (body: SubmitRequestBody) => post<EmergencyRequest>('/requests', body),
  approveRequest: (requestId: string) => post<EmergencyRequest>(`/requests/${requestId}/approve`),
  rejectRequest: (requestId: string, reason: string) =>
    post<EmergencyRequest>(`/requests/${requestId}/reject`, { reason }),
  cancelRequest: (vehicleId: string, reason: string) => post<{ ok: true }>('/requests/cancel', { vehicleId, reason }),
  confirmArrival: (requestId: string) => post<{ ok: true }>(`/requests/${requestId}/arrived`),

  // routes
  routes: (activeOnly = true) => get<Route[]>(`/routes?active=${activeOnly}`),
  applyRouteGeometry: (
    routeId: string,
    payload: { path: LatLng[]; distanceM?: number; etaSeconds?: number; source?: 'GOOGLE_ROUTES' | 'GOOGLE_DIRECTIONS' },
  ) => post<Route>(`/routes/${routeId}/geometry`, payload),
  reroute: (vehicleId: string, reason?: string) => post<Route>('/routes/reroute', { vehicleId, reason }),

  // operations
  corridors: () => get<Corridor[]>('/corridors'),
  conflicts: () => get<Conflict[]>('/conflicts'),
  junction: (junctionId: string) => get<JunctionDetail>(`/junctions/${junctionId}`),
  impact: () => get<PublicTrafficImpact>('/impact'),

  // incidents
  incidents: () => get<Incident[]>('/incidents'),
  createIncident: (body: {
    kind: string;
    severity: Severity;
    position: LatLng;
    address: string;
    description: string;
    ownerFacilityId?: string;
  }) => post<Incident>('/incidents', body),
  assignIncident: (incidentId: string, body: { vehicleId: string; driverId?: string; severity?: Severity; note?: string }) =>
    post<{ incident: Incident; request: EmergencyRequest }>(`/incidents/${incidentId}/assign`, body),
  resolveIncident: (incidentId: string) => post<Incident>(`/incidents/${incidentId}/resolve`),

  // notifications & timeline
  notifications: () => get<Notification[]>('/notifications'),
  markNotificationRead: (id: string) => post<Notification>(`/notifications/${id}/read`),
  timeline: (query?: { requestId?: string; vehicleId?: string }) => {
    const params = new URLSearchParams();
    if (query?.requestId) params.set('requestId', query.requestId);
    if (query?.vehicleId) params.set('vehicleId', query.vehicleId);
    const suffix = params.toString();
    return get<TimelineEvent[]>(`/timeline${suffix ? `?${suffix}` : ''}`);
  },

  // hardware
  hardware: () =>
    get<{ mode: string; devices: HardwareDevice[]; junctionStates: JunctionRuntimeState[]; watchdogTimeoutMs: number }>(
      '/hardware',
    ),

  // simulation
  simulation: () => get<{ state: SimulationState; scenarios: SimulationScenario[] }>('/simulation'),
  startScenario: (scenarioId: string) => post<SimulationState>('/simulation/scenario', { scenarioId }),
  stopScenario: () => post<SimulationState>('/simulation/stop'),
  setSimulationSpeed: (speed: number) => post<SimulationState>('/simulation/speed', { speed }),
  resetSimulation: () => post<SimulationState>('/simulation/reset'),
  injectFault: (body: { kind: 'gps' | 'junction' | 'traffic' | 'road'; targetId: string; enabled?: boolean; traffic?: string }) =>
    post<{ ok: true }>('/simulation/fault', body),
};
