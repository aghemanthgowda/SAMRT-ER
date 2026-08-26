import { EventEmitter } from 'node:events';
import type { ServerToClientEvents } from '@smart-er/core';

type EventName = keyof ServerToClientEvents;
type Payload<K extends EventName> = Parameters<ServerToClientEvents[K]>[0];

/**
 * In-process event bus.
 *
 * Services publish domain events here; the Socket.IO gateway subscribes and
 * fans them out to dashboards. Keeping the bus separate from the socket server
 * means services never import transport code, and tests can assert on emitted
 * events without opening a port.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // A control room may have many dashboards open; the default cap of 10 is
    // low enough to produce spurious leak warnings.
    this.emitter.setMaxListeners(64);
  }

  emit<K extends EventName>(event: K, payload: Payload<K>): void {
    this.emitter.emit(event, payload);
  }

  on<K extends EventName>(event: K, listener: (payload: Payload<K>) => void): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return () => {
      this.emitter.off(event, listener as (...args: unknown[]) => void);
    };
  }

  /** Subscribe to every event. Used by the socket gateway and by tests. */
  onAny(listener: (event: EventName, payload: unknown) => void): () => void {
    const names: EventName[] = [
      'state.snapshot',
      'vehicle.state',
      'vehicle.states',
      'request.created',
      'request.updated',
      'route.created',
      'route.updated',
      'corridor.created',
      'corridor.updated',
      'corridor.released',
      'junction.updated',
      'junction.states',
      'conflict.detected',
      'conflict.resolved',
      'signal.command',
      'signal.ack',
      'incident.created',
      'incident.updated',
      'notification.created',
      'timeline.event',
      'traffic.updated',
      'impact.updated',
      'hardware.updated',
      'simulation.updated',
    ];

    const unsubscribers = names.map((name) =>
      this.on(name, (payload) => listener(name, payload)),
    );
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }

  removeAll(): void {
    this.emitter.removeAllListeners();
  }
}
