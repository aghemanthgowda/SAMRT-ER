import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type {
  Conflict,
  Corridor,
  EmergencyRequest,
  Facility,
  HardwareDevice,
  Incident,
  Junction,
  JunctionRuntimeState,
  Notification,
  OperationalSnapshot,
  PublicTrafficImpact,
  RoadSegment,
  Route,
  SimulationState,
  TimelineEvent,
  VehicleState,
} from '@smart-er/core';
import { api } from '@/api/client';
import { connectSocket, disconnectSocket, type SmartErSocket } from '@/api/socket';

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

/** What the operator has selected on the map or in a list. */
export interface Selection {
  kind: 'vehicle' | 'junction' | 'route' | 'conflict' | 'incident' | 'facility';
  id: string;
}

interface OpsState {
  connection: ConnectionStatus;
  loaded: boolean;
  error?: string;

  vehicles: Record<string, VehicleState>;
  requests: Record<string, EmergencyRequest>;
  routes: Record<string, Route>;
  corridors: Record<string, Corridor>;
  conflicts: Record<string, Conflict>;
  incidents: Record<string, Incident>;
  junctions: Junction[];
  junctionStates: Record<string, JunctionRuntimeState>;
  roadSegments: RoadSegment[];
  devices: Record<string, HardwareDevice>;
  facilities: Facility[];
  impact?: PublicTrafficImpact;
  timeline: TimelineEvent[];
  notifications: Notification[];
  simulation?: SimulationState;

  selection?: Selection;
  /** Vehicles the operator has hidden from the map. */
  hiddenVehicleIds: Set<string>;

  connect(token: string): void;
  disconnect(): void;
  select(selection: Selection | undefined): void;
  toggleVehicleVisibility(vehicleId: string): void;
  refresh(): Promise<void>;
}

const TIMELINE_CAP = 400;

function indexBy<T>(items: readonly T[], key: (item: T) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[key(item)] = item;
  return out;
}

/**
 * The realtime operational state every dashboard renders from.
 *
 * One socket, one store. The server sends a full snapshot on connect and
 * deltas thereafter, so nothing here polls. Entities are held in maps keyed by
 * id because updates arrive one entity at a time, and rebuilding an array on
 * every vehicle tick would re-render every row in the console.
 */
export const useOpsStore = create<OpsState>((set, get) => {
  let socket: SmartErSocket | undefined;

  const applySnapshot = (snapshot: OperationalSnapshot) => {
    set({
      vehicles: indexBy(snapshot.vehicles, (v) => v.vehicleId),
      requests: indexBy(snapshot.requests, (r) => r.id),
      routes: indexBy(snapshot.routes, (r) => r.id),
      corridors: indexBy(snapshot.corridors, (c) => c.id),
      conflicts: indexBy(snapshot.conflicts, (c) => c.id),
      incidents: indexBy(snapshot.incidents, (i) => i.id),
      junctions: snapshot.junctions,
      junctionStates: indexBy(snapshot.junctionStates, (j) => j.junctionId),
      roadSegments: snapshot.roadSegments,
      devices: indexBy(snapshot.devices, (d) => d.id),
      impact: snapshot.impact,
      timeline: snapshot.timeline.slice(-TIMELINE_CAP),
      notifications: snapshot.notifications,
      simulation: snapshot.simulation,
      loaded: true,
      error: undefined,
    });
  };

  return {
    connection: 'connecting',
    loaded: false,
    vehicles: {},
    requests: {},
    routes: {},
    corridors: {},
    conflicts: {},
    incidents: {},
    junctions: [],
    junctionStates: {},
    roadSegments: [],
    devices: {},
    facilities: [],
    timeline: [],
    notifications: [],
    hiddenVehicleIds: new Set(),

    connect(token) {
      if (socket?.connected) return;
      set({ connection: 'connecting' });

      socket = connectSocket(token);

      socket.on('connect', () => {
        set({ connection: 'live' });
        socket?.emit('subscribe', {});
      });
      socket.on('disconnect', () => set({ connection: 'reconnecting' }));
      socket.io.on('reconnect_attempt', () => set({ connection: 'reconnecting' }));
      socket.io.on('reconnect_failed', () => set({ connection: 'offline' }));
      socket.on('connect_error', (error: Error) => {
        set({ connection: 'offline', error: error.message });
      });

      socket.on('state.snapshot', applySnapshot);

      socket.on('vehicle.state', (state) =>
        set((current) => ({ vehicles: { ...current.vehicles, [state.vehicleId]: state } })),
      );
      socket.on('vehicle.states', (states) =>
        set((current) => ({ vehicles: { ...current.vehicles, ...indexBy(states, (v) => v.vehicleId) } })),
      );

      const upsert =
        <K extends 'requests' | 'routes' | 'corridors' | 'conflicts' | 'incidents'>(key: K, idOf: (item: never) => string) =>
        (item: unknown) =>
          set((current) => ({
            [key]: { ...current[key], [idOf(item as never)]: item },
          }) as Partial<OpsState>);

      socket.on('request.created', upsert('requests', (r: EmergencyRequest) => r.id));
      socket.on('request.updated', upsert('requests', (r: EmergencyRequest) => r.id));
      socket.on('route.created', upsert('routes', (r: Route) => r.id));
      socket.on('route.updated', upsert('routes', (r: Route) => r.id));
      socket.on('corridor.created', upsert('corridors', (c: Corridor) => c.id));
      socket.on('corridor.updated', upsert('corridors', (c: Corridor) => c.id));
      socket.on('conflict.detected', upsert('conflicts', (c: Conflict) => c.id));
      socket.on('conflict.resolved', upsert('conflicts', (c: Conflict) => c.id));
      socket.on('incident.created', upsert('incidents', (i: Incident) => i.id));
      socket.on('incident.updated', upsert('incidents', (i: Incident) => i.id));

      socket.on('junction.states', (states) =>
        set({ junctionStates: indexBy(states, (j) => j.junctionId) }),
      );
      socket.on('traffic.updated', (segments) => set({ roadSegments: segments }));
      socket.on('impact.updated', (impact) => set({ impact }));
      socket.on('hardware.updated', (devices) => set({ devices: indexBy(devices, (d) => d.id) }));
      socket.on('simulation.updated', (simulation) => set({ simulation }));

      socket.on('timeline.event', (event) =>
        set((current) => ({ timeline: [...current.timeline, event].slice(-TIMELINE_CAP) })),
      );
      socket.on('notification.created', (notification) =>
        set((current) => ({ notifications: [notification, ...current.notifications].slice(0, 100) })),
      );

      // Facilities never change during a session, so they are fetched once
      // rather than carried in every snapshot.
      void api
        .facilities()
        .then((facilities) => set({ facilities }))
        .catch(() => undefined);
    },

    disconnect() {
      disconnectSocket();
      socket = undefined;
      set({ connection: 'offline', loaded: false });
    },

    select(selection) {
      set({ selection });
    },

    toggleVehicleVisibility(vehicleId) {
      const hidden = new Set(get().hiddenVehicleIds);
      if (hidden.has(vehicleId)) hidden.delete(vehicleId);
      else hidden.add(vehicleId);
      set({ hiddenVehicleIds: hidden });
    },

    async refresh() {
      try {
        applySnapshot(await api.snapshot());
      } catch (error) {
        set({ error: (error as Error).message });
      }
    },
  };
});

// -- derived views ------------------------------------------------------------
/**
 * Derived state is exposed as hooks rather than raw selectors.
 *
 * Each of these builds a new array every time it runs. Handed straight to
 * `useOpsStore`, that array is a new reference on every store notification —
 * and since the store is notified roughly once a second by vehicle telemetry,
 * the component would re-render on every tick and, worse, React would treat
 * the fresh reference as a changed snapshot and loop.
 *
 * `useShallow` compares the produced array element by element, so a component
 * re-renders only when the set it actually cares about changes. Wrapping it
 * here rather than at each call site means a screen cannot get it wrong.
 */

export const useVehicleList = (): VehicleState[] =>
  useOpsStore(
    useShallow((state) =>
      Object.values(state.vehicles).sort((a, b) => a.vehicleId.localeCompare(b.vehicleId)),
    ),
  );

export const useActiveVehicles = (): VehicleState[] =>
  useOpsStore(
    useShallow((state) =>
      Object.values(state.vehicles)
        .filter(
          (vehicle) =>
            vehicle.status === 'ACTIVE' || vehicle.status === 'REROUTING' || vehicle.status === 'REQUESTED',
        )
        .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId)),
    ),
  );

export const usePendingRequests = (): EmergencyRequest[] =>
  useOpsStore(
    useShallow((state) =>
      Object.values(state.requests)
        .filter((request) => request.status === 'PENDING')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    ),
  );

export const useActiveRoutes = (): Route[] =>
  useOpsStore(useShallow((state) => Object.values(state.routes).filter((route) => route.active)));

export const useActiveCorridors = (): Corridor[] =>
  useOpsStore(
    useShallow((state) =>
      Object.values(state.corridors).filter(
        (corridor) => corridor.status === 'ACTIVE' || corridor.status === 'PENDING',
      ),
    ),
  );

export const useConflictList = (): Conflict[] =>
  useOpsStore(
    useShallow((state) =>
      Object.values(state.conflicts).sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)),
    ),
  );

export const useOpenIncidents = (): Incident[] =>
  useOpsStore(
    useShallow((state) =>
      Object.values(state.incidents)
        .filter((incident) => incident.status !== 'RESOLVED')
        .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt)),
    ),
  );
