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
import { MemoryRepository, RingRepository, type PersistenceSink, type Repositories } from './repositories.js';
import { EntityTable, openDatabase, readMeta, writeMeta, type Database } from './sqlite.js';
import type { SeedData } from './seed.js';
import type { PasswordResetRecord } from '../auth/passwords.js';

/**
 * Assembles the repository set, with or without durable storage behind it.
 *
 * Two modes, one interface. In memory the system behaves exactly as it always
 * has — nothing survives a restart, which is what a test wants. Against a file
 * every write is mirrored to SQLite and boot restores what the last run left.
 * Services see `Repositories` either way and cannot tell the difference.
 */

export interface PersistenceOptions {
  /** SQLite file, or `:memory:`. Omit for a purely in-memory store. */
  databasePath?: string | undefined;
}

export interface PersistenceResult {
  repositories: Repositories;
  passwordHashes: Map<string, string>;
  /** Present only when storage is durable. */
  db?: Database;
  /** True when this boot wrote the seed dataset rather than loading one. */
  seeded: boolean;
}

/** Names the durable collections. Kept explicit so a typo cannot orphan data. */
const COLLECTIONS = {
  users: 'users',
  organizations: 'organizations',
  drivers: 'drivers',
  vehicles: 'vehicles',
  vehicleStates: 'vehicleStates',
  facilities: 'facilities',
  devices: 'devices',
  requests: 'requests',
  incidents: 'incidents',
  routes: 'routes',
  corridors: 'corridors',
  conflicts: 'conflicts',
  commands: 'commands',
  notifications: 'notifications',
  timeline: 'timeline',
} as const;

function sink<T>(table: EntityTable<T>): PersistenceSink<T> {
  return {
    put: (id, entity) => table.put(id, entity),
    remove: (id) => table.remove(id),
  };
}

export function createRepositories(
  seed: SeedData,
  initialVehicleStates: VehicleState[],
  devices: HardwareDevice[],
  options: PersistenceOptions = {},
): PersistenceResult {
  if (!options.databasePath) {
    return {
      repositories: memoryRepositories(seed, initialVehicleStates, devices),
      passwordHashes: seed.passwordHashes,
      seeded: true,
    };
  }

  const db = openDatabase(options.databasePath);
  const table = <T>(name: string) => new EntityTable<T>(db, name);

  const users = table<User>(COLLECTIONS.users);
  const organizations = table<Organization>(COLLECTIONS.organizations);
  const drivers = table<Driver>(COLLECTIONS.drivers);
  const vehicles = table<Vehicle>(COLLECTIONS.vehicles);
  const vehicleStates = table<VehicleState>(COLLECTIONS.vehicleStates);
  const facilities = table<Facility>(COLLECTIONS.facilities);
  const deviceTable = table<HardwareDevice>(COLLECTIONS.devices);
  const requests = table<EmergencyRequest>(COLLECTIONS.requests);
  const incidents = table<Incident>(COLLECTIONS.incidents);
  const routes = table<Route>(COLLECTIONS.routes);
  const corridors = table<Corridor>(COLLECTIONS.corridors);
  const conflicts = table<Conflict>(COLLECTIONS.conflicts);
  const commands = table<SignalCommand>(COLLECTIONS.commands);
  const notifications = table<Notification>(COLLECTIONS.notifications);
  const timeline = table<TimelineEvent>(COLLECTIONS.timeline);

  const repositories: Repositories = {
    users: new MemoryRepository<User>((entity) => entity.id, [], sink(users)),
    organizations: new MemoryRepository<Organization>((entity) => entity.id, [], sink(organizations)),
    drivers: new MemoryRepository<Driver>((entity) => entity.id, [], sink(drivers)),
    vehicles: new MemoryRepository<Vehicle>((entity) => entity.id, [], sink(vehicles)),
    vehicleStates: new MemoryRepository<VehicleState>((entity) => entity.vehicleId, [], sink(vehicleStates)),
    facilities: new MemoryRepository<Facility>((entity) => entity.id, [], sink(facilities)),
    devices: new MemoryRepository<HardwareDevice>((entity) => entity.id, [], sink(deviceTable)),
    requests: new MemoryRepository<EmergencyRequest>((entity) => entity.id, [], sink(requests)),
    incidents: new MemoryRepository<Incident>((entity) => entity.id, [], sink(incidents)),
    routes: new MemoryRepository<Route>((entity) => entity.id, [], sink(routes)),
    corridors: new MemoryRepository<Corridor>((entity) => entity.id, [], sink(corridors)),
    conflicts: new MemoryRepository<Conflict>((entity) => entity.id, [], sink(conflicts)),
    commands: new RingRepository<SignalCommand>((entity) => entity.id, 500, sink(commands)),
    notifications: new RingRepository<Notification>((entity) => entity.id, 300, sink(notifications)),
    timeline: new RingRepository<TimelineEvent>((entity) => entity.id, 800, sink(timeline)),
  };

  // An existing database is authoritative. Re-seeding over it would discard
  // changed passwords, decommissioned vehicles and the entire run history —
  // so the seed is written once, into an empty database, and never again.
  const isEmpty = users.count() === 0;

  if (isEmpty) {
    repositories.users.putAll(seed.users);
    repositories.organizations.putAll(seed.organizations);
    repositories.drivers.putAll(seed.drivers);
    repositories.vehicles.putAll(seed.vehicles);
    repositories.vehicleStates.putAll(initialVehicleStates);
    repositories.facilities.putAll(seed.facilities);
    repositories.devices.putAll(devices);
    repositories.incidents.putAll(seed.incidents);
    writeMeta(db, 'seededAt', new Date().toISOString());
    for (const [userId, hash] of seed.passwordHashes) writeCredential(db, userId, hash);
  } else {
    (repositories.users as MemoryRepository<User>).hydrate(users.load());
    (repositories.organizations as MemoryRepository<Organization>).hydrate(organizations.load());
    (repositories.drivers as MemoryRepository<Driver>).hydrate(drivers.load());
    (repositories.vehicles as MemoryRepository<Vehicle>).hydrate(vehicles.load());
    (repositories.vehicleStates as MemoryRepository<VehicleState>).hydrate(vehicleStates.load());
    (repositories.facilities as MemoryRepository<Facility>).hydrate(facilities.load());
    (repositories.incidents as MemoryRepository<Incident>).hydrate(incidents.load());
    (repositories.requests as MemoryRepository<EmergencyRequest>).hydrate(requests.load());
    (repositories.routes as MemoryRepository<Route>).hydrate(routes.load());
    (repositories.corridors as MemoryRepository<Corridor>).hydrate(corridors.load());
    (repositories.conflicts as MemoryRepository<Conflict>).hydrate(conflicts.load());
    (repositories.commands as RingRepository<SignalCommand>).hydrate(commands.load());
    (repositories.notifications as RingRepository<Notification>).hydrate(notifications.load());
    (repositories.timeline as RingRepository<TimelineEvent>).hydrate(timeline.load());

    // Devices are the exception: the stored rows describe hardware that was
    // reachable during the last run, and this boot has just constructed a
    // fresh bundle whose health is unknown until it reports. Take the live
    // set, not the remembered one.
    repositories.devices.putAll(devices);
  }

  return { repositories, passwordHashes: loadCredentials(db), db, seeded: isEmpty };
}

function memoryRepositories(
  seed: SeedData,
  initialVehicleStates: VehicleState[],
  devices: HardwareDevice[],
): Repositories {
  return {
    users: new MemoryRepository<User>((entity) => entity.id, seed.users),
    organizations: new MemoryRepository<Organization>((entity) => entity.id, seed.organizations),
    drivers: new MemoryRepository<Driver>((entity) => entity.id, seed.drivers),
    vehicles: new MemoryRepository<Vehicle>((entity) => entity.id, seed.vehicles),
    vehicleStates: new MemoryRepository<VehicleState>((entity) => entity.vehicleId, initialVehicleStates),
    facilities: new MemoryRepository<Facility>((entity) => entity.id, seed.facilities),
    devices: new MemoryRepository<HardwareDevice>((entity) => entity.id, devices),
    requests: new MemoryRepository<EmergencyRequest>((entity) => entity.id),
    incidents: new MemoryRepository<Incident>((entity) => entity.id, seed.incidents),
    routes: new MemoryRepository<Route>((entity) => entity.id),
    corridors: new MemoryRepository<Corridor>((entity) => entity.id),
    conflicts: new MemoryRepository<Conflict>((entity) => entity.id),
    commands: new RingRepository<SignalCommand>((entity) => entity.id, 500),
    notifications: new RingRepository<Notification>((entity) => entity.id, 300),
    timeline: new RingRepository<TimelineEvent>((entity) => entity.id, 800),
  };
}

// -- credentials -------------------------------------------------------------

/**
 * Password hashes live in their own table, never in the user document.
 *
 * `User` has no field for one, so a hash cannot be serialised into an API
 * response by accident; keeping the storage separate as well means it cannot
 * be reintroduced by adding a field either.
 */
export function writeCredential(db: Database, userId: string, passwordHash: string): void {
  db.prepare(
    `INSERT INTO credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
  ).run(userId, passwordHash, new Date().toISOString());
}

export function loadCredentials(db: Database): Map<string, string> {
  const rows = db.prepare('SELECT user_id, password_hash FROM credentials').all() as {
    user_id: string;
    password_hash: string;
  }[];
  return new Map(rows.map((row) => [row.user_id, row.password_hash]));
}

// -- response history --------------------------------------------------------

export interface ResponseHistoryRow {
  date: string;
  runs: number;
  secondsSaved: number;
  baselineSeconds: number;
}

export function loadResponseHistory(db: Database): ResponseHistoryRow[] {
  const rows = db.prepare('SELECT date, runs, seconds_saved, baseline_seconds FROM response_history').all() as {
    date: string;
    runs: number;
    seconds_saved: number;
    baseline_seconds: number;
  }[];
  return rows.map((row) => ({
    date: row.date,
    runs: Number(row.runs),
    secondsSaved: Number(row.seconds_saved),
    baselineSeconds: Number(row.baseline_seconds),
  }));
}

export function writeResponseHistory(db: Database, row: ResponseHistoryRow): void {
  db.prepare(
    `INSERT INTO response_history (date, runs, seconds_saved, baseline_seconds) VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       runs = excluded.runs,
       seconds_saved = excluded.seconds_saved,
       baseline_seconds = excluded.baseline_seconds`,
  ).run(row.date, row.runs, row.secondsSaved, row.baselineSeconds);
}

// -- password reset tokens ---------------------------------------------------

export function insertPasswordReset(db: Database, record: PasswordResetRecord): void {
  db.prepare(
    `INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(token_hash) DO UPDATE SET
       user_id = excluded.user_id,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at,
       used_at = excluded.used_at`,
  ).run(record.tokenHash, record.userId, record.createdAt, record.expiresAt, record.usedAt ?? null);
}

export function deletePasswordResets(db: Database, userId: string): void {
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId);
}

/** Live tokens only — an expired row is dropped on the way past. */
export function loadPasswordResets(db: Database): PasswordResetRecord[] {
  db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(new Date().toISOString());

  const rows = db.prepare('SELECT token_hash, user_id, created_at, expires_at, used_at FROM password_resets').all() as {
    token_hash: string;
    user_id: string;
    created_at: string;
    expires_at: string;
    used_at: string | null;
  }[];

  return rows.map((row) => ({
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ...(row.used_at ? { usedAt: row.used_at } : {}),
  }));
}

export { readMeta, writeMeta };
