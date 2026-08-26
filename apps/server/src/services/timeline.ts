import type { Severity, TimelineEvent } from '@smart-er/core';
import { nextId } from '@smart-er/core';
import type { Store } from '../db/store.js';
import type { EventBus } from '../realtime/bus.js';

export interface TimelineInput {
  kind: string;
  message: string;
  requestId?: string;
  vehicleId?: string;
  junctionId?: string;
  corridorId?: string;
  incidentId?: string;
  severity?: Severity;
  data?: Record<string, unknown>;
}

/**
 * The incident timeline.
 *
 * Every consequential decision is recorded here in the order it happened, in
 * language a controller can read back during a debrief. This is not a debug
 * log: it is the operational record of why the system did what it did, and it
 * is what the decision-explanation panels render.
 */
export class TimelineService {
  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
  ) {}

  record(input: TimelineInput): TimelineEvent {
    const event: TimelineEvent = {
      id: nextId('EVT'),
      at: this.store.now(),
      ...input,
    };
    this.store.repositories.timeline.put(event);
    this.bus.emit('timeline.event', event);
    return event;
  }

  recent(count = 120): TimelineEvent[] {
    const all = this.store.repositories.timeline.list();
    return all.slice(Math.max(0, all.length - count));
  }

  forRequest(requestId: string): TimelineEvent[] {
    return this.store.repositories.timeline.find((event) => event.requestId === requestId);
  }

  forVehicle(vehicleId: string): TimelineEvent[] {
    return this.store.repositories.timeline.find((event) => event.vehicleId === vehicleId);
  }
}
