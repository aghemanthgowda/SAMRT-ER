import { computePublicImpact, type OperationalSnapshot } from '@smart-er/core';
import { isoNow } from '@smart-er/core';
import type { Store } from '../db/store.js';
import { EventBus } from '../realtime/bus.js';
import { CorridorRuntime } from './corridorRuntime.js';
import { DispatchService } from './dispatch.js';
import { NotificationService } from './notifications.js';
import { RoutingService } from './routing.js';
import { TimelineService } from './timeline.js';
import { SimulationEngine } from '../simulation/engine.js';

/**
 * Composition root.
 *
 * Every service is constructed here and handed its dependencies explicitly.
 * There are no module-level singletons, so a test can stand up a complete,
 * isolated system in one call.
 */
export interface AppContext {
  store: Store;
  bus: EventBus;
  routing: RoutingService;
  corridors: CorridorRuntime;
  notifications: NotificationService;
  timeline: TimelineService;
  dispatch: DispatchService;
  simulation: SimulationEngine;
  snapshot(): OperationalSnapshot;
  shutdown(): Promise<void>;
}

export function createContext(store: Store): AppContext {
  const bus = new EventBus();
  const timeline = new TimelineService(store, bus);
  const notifications = new NotificationService(store, bus);
  const routing = new RoutingService(store);
  const corridors = new CorridorRuntime(store, bus, timeline);
  const dispatch = new DispatchService(store, bus, routing, corridors, notifications, timeline);
  const simulation = new SimulationEngine(store, bus, dispatch, corridors, timeline, routing);

  const snapshot = (): OperationalSnapshot => ({
    serverTime: isoNow(),
    vehicles: store.repositories.vehicleStates.list(),
    requests: store.repositories.requests.list(),
    routes: store.repositories.routes.list(),
    corridors: store.repositories.corridors.list(),
    conflicts: store.repositories.conflicts.list(),
    incidents: store.repositories.incidents.list(),
    junctions: store.graph.junctions,
    junctionStates: corridors.states(),
    roadSegments: store.graph.segments,
    devices: store.repositories.devices.list(),
    impact: computePublicImpact({ junctions: store.graph.junctions, corridors: store.activeCorridors() }),
    timeline: timeline.recent(150),
    notifications: store.repositories.notifications.list().slice(-80),
    simulation: simulation.state(),
  });

  return {
    store,
    bus,
    routing,
    corridors,
    notifications,
    timeline,
    dispatch,
    simulation,
    snapshot,
    async shutdown() {
      simulation.stop();
      bus.removeAll();
      await store.hardware.shutdown();
    },
  };
}
