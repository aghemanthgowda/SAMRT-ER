import type { Notification, Role, Severity } from '@smart-er/core';
import { nextId } from '@smart-er/core';
import type { Store } from '../db/store.js';
import type { EventBus } from '../realtime/bus.js';

export interface NotificationInput {
  audience: { facilityId?: string; userId?: string; role?: Role };
  title: string;
  body: string;
  severity: Severity;
  requestId?: string;
  vehicleId?: string;
  incidentId?: string;
}

/**
 * Notification fan-out.
 *
 * A hospital learns about an inbound ambulance the moment the controller
 * approves the request — not when the crew radios ahead. Notifications are
 * addressed to a facility, a specific user, or a role, and delivered over the
 * realtime bus.
 */
export class NotificationService {
  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
  ) {}

  send(input: NotificationInput): Notification {
    const notification: Notification = {
      id: nextId('NTF'),
      createdAt: this.store.now(),
      ...input,
    };
    this.store.repositories.notifications.put(notification);
    this.bus.emit('notification.created', notification);
    return notification;
  }

  /** Notifications visible to a given viewer, newest first. */
  for(viewer: { userId: string; role: Role; facilityId?: string }): Notification[] {
    return this.store.repositories.notifications
      .find((notification) => {
        const { audience } = notification;
        if (audience.userId && audience.userId === viewer.userId) return true;
        if (audience.facilityId && audience.facilityId === viewer.facilityId) return true;
        if (audience.role && audience.role === viewer.role) return true;
        return false;
      })
      .reverse();
  }

  markRead(notificationId: string): Notification | undefined {
    const existing = this.store.repositories.notifications.get(notificationId);
    if (!existing) return undefined;
    const updated = { ...existing, readAt: this.store.now() };
    this.store.repositories.notifications.put(updated);
    return updated;
  }
}
