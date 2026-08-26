import type {
  Conflict,
  Corridor,
  Driver,
  EmergencyRequest,
  Facility,
  HardwareDevice,
  Incident,
  Notification,
  Organization,
  Route,
  SignalCommand,
  TimelineEvent,
  User,
  Vehicle,
  VehicleState,
} from '@smart-er/core';

/**
 * Persistence contracts.
 *
 * Phase 1 runs against an in-memory implementation so the whole system starts
 * with `npm run dev` and no database to provision — which matters when the
 * point of the phase is to demonstrate the software end to end. Everything the
 * application does goes through these interfaces, so moving to Postgres or
 * SQLite later is a new implementation of this file and a different wiring in
 * `store.ts`, not a change to any service.
 */

export interface ReadRepository<T> {
  get(id: string): T | undefined;
  list(): T[];
  find(predicate: (entity: T) => boolean): T[];
}

export interface WriteRepository<T> extends ReadRepository<T> {
  put(entity: T): T;
  putAll(entities: readonly T[]): void;
  remove(id: string): boolean;
}

export interface Repositories {
  users: WriteRepository<User>;
  organizations: WriteRepository<Organization>;
  drivers: WriteRepository<Driver>;
  vehicles: WriteRepository<Vehicle>;
  vehicleStates: WriteRepository<VehicleState>;
  facilities: WriteRepository<Facility>;
  devices: WriteRepository<HardwareDevice>;
  requests: WriteRepository<EmergencyRequest>;
  incidents: WriteRepository<Incident>;
  routes: WriteRepository<Route>;
  corridors: WriteRepository<Corridor>;
  conflicts: WriteRepository<Conflict>;
  commands: WriteRepository<SignalCommand>;
  notifications: WriteRepository<Notification>;
  timeline: WriteRepository<TimelineEvent>;
}

/** In-memory repository keyed by an id extractor. */
export class MemoryRepository<T> implements WriteRepository<T> {
  private readonly items = new Map<string, T>();

  constructor(
    private readonly idOf: (entity: T) => string,
    seed: readonly T[] = [],
  ) {
    this.putAll(seed);
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  list(): T[] {
    return [...this.items.values()];
  }

  find(predicate: (entity: T) => boolean): T[] {
    return this.list().filter(predicate);
  }

  put(entity: T): T {
    this.items.set(this.idOf(entity), entity);
    return entity;
  }

  putAll(entities: readonly T[]): void {
    for (const entity of entities) this.put(entity);
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }
}

/**
 * Append-only repository with a retention cap.
 *
 * The incident timeline is written on every state transition of every vehicle,
 * so an unbounded list would grow without limit in a long-running control room.
 * Oldest entries are dropped once the cap is reached.
 */
export class RingRepository<T> implements WriteRepository<T> {
  private readonly items = new Map<string, T>();

  constructor(
    private readonly idOf: (entity: T) => string,
    private readonly capacity: number,
  ) {}

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  list(): T[] {
    return [...this.items.values()];
  }

  find(predicate: (entity: T) => boolean): T[] {
    return this.list().filter(predicate);
  }

  put(entity: T): T {
    this.items.set(this.idOf(entity), entity);
    while (this.items.size > this.capacity) {
      const oldest = this.items.keys().next();
      if (oldest.done) break;
      this.items.delete(oldest.value);
    }
    return entity;
  }

  putAll(entities: readonly T[]): void {
    for (const entity of entities) this.put(entity);
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  /** Most recent `count` entries, newest last. */
  recent(count: number): T[] {
    const all = this.list();
    return all.slice(Math.max(0, all.length - count));
  }
}
