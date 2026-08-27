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

/**
 * Where a repository mirrors its writes so they survive a restart.
 *
 * The repositories keep answering reads from memory either way — the sink is
 * told about mutations, it is never consulted about a lookup. That is what
 * lets durability be added without changing the cost of the reads the
 * simulation does on every tick.
 */
export interface PersistenceSink<T> {
  put(id: string, entity: T): void;
  remove(id: string): void;
}

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
    private readonly sink?: PersistenceSink<T>,
  ) {
    this.putAll(seed);
  }

  /**
   * Populate from storage without writing back.
   *
   * Used at boot to restore what a previous run left behind; going through
   * `put` would re-persist every row that was just read.
   */
  hydrate(entities: readonly T[]): void {
    for (const entity of entities) this.items.set(this.idOf(entity), entity);
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
    const id = this.idOf(entity);
    this.items.set(id, entity);
    this.sink?.put(id, entity);
    return entity;
  }

  putAll(entities: readonly T[]): void {
    for (const entity of entities) this.put(entity);
  }

  remove(id: string): boolean {
    const existed = this.items.delete(id);
    if (existed) this.sink?.remove(id);
    return existed;
  }

  clear(): void {
    for (const id of this.items.keys()) this.sink?.remove(id);
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
    private readonly sink?: PersistenceSink<T>,
  ) {}

  /**
   * Populate from storage without writing back, oldest first.
   *
   * Insertion order is load-bearing here — `recent()` reads the tail and the
   * cap drops the head — so the restored order has to match the order the
   * entries were originally written in, not whatever the query returned.
   */
  hydrate(entities: readonly T[]): void {
    for (const entity of entities) {
      this.items.set(this.idOf(entity), entity);
    }
    this.trim();
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
    const id = this.idOf(entity);
    this.items.set(id, entity);
    this.sink?.put(id, entity);
    this.trim();
    return entity;
  }

  putAll(entities: readonly T[]): void {
    for (const entity of entities) this.put(entity);
  }

  remove(id: string): boolean {
    const existed = this.items.delete(id);
    if (existed) this.sink?.remove(id);
    return existed;
  }

  /** Drop oldest entries until the cap is respected, in storage as well. */
  private trim(): void {
    while (this.items.size > this.capacity) {
      const oldest = this.items.keys().next();
      if (oldest.done) break;
      this.items.delete(oldest.value);
      this.sink?.remove(oldest.value);
    }
  }

  /** Most recent `count` entries, newest last. */
  recent(count: number): T[] {
    const all = this.list();
    return all.slice(Math.max(0, all.length - count));
  }
}
