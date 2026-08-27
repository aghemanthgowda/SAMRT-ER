import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType, StatementSync } from 'node:sqlite';

/**
 * Durable storage for the repositories.
 *
 * `node:sqlite` is used rather than a driver from npm because it needs no
 * native compilation and no server to provision: the property that made the
 * in-memory store attractive — `npm run dev` and the system is up — survives
 * gaining a database. It is loaded through `createRequire` so the module is
 * only pulled in when persistence is actually switched on, which keeps its
 * experimental-feature warning off the console of anyone running in memory.
 *
 * Reads stay in memory. Every repository keeps the same `Map` it always had
 * and answers `get`/`list`/`find` from it; SQLite is written through on each
 * mutation and read once, at boot, to repopulate. That matters because the
 * simulation calls `activeRoutes()` and friends on every tick: parsing every
 * stored document on every read would turn a durability change into a
 * throughput regression.
 */

const require = createRequire(import.meta.url);

type SqliteModule = { DatabaseSync: new (path: string) => DatabaseSyncType };

export type Database = DatabaseSyncType;

/** Bumped when the stored shape changes in a way old rows cannot satisfy. */
export const SCHEMA_VERSION = 1;

export function openDatabase(file: string): Database {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }

  const { DatabaseSync } = require('node:sqlite') as SqliteModule;
  const db = new DatabaseSync(file);

  // WAL keeps the once-a-second simulation writes from blocking reads, and
  // NORMAL synchronous is the right trade for state we can reconstruct.
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      collection TEXT NOT NULL,
      id         TEXT NOT NULL,
      doc        TEXT NOT NULL,
      seq        INTEGER NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS entities_by_seq ON entities (collection, seq);

    CREATE TABLE IF NOT EXISTS credentials (
      user_id       TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS password_resets_by_user ON password_resets (user_id);

    CREATE TABLE IF NOT EXISTS response_history (
      date             TEXT PRIMARY KEY,
      runs             INTEGER NOT NULL,
      seconds_saved    REAL NOT NULL,
      baseline_seconds REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const version = readMeta(db, 'schemaVersion');
  if (version === undefined) {
    writeMeta(db, 'schemaVersion', String(SCHEMA_VERSION));
  } else if (Number(version) !== SCHEMA_VERSION) {
    throw new Error(
      `Database at ${file} was written by schema version ${version}, but this build expects ` +
        `${SCHEMA_VERSION}. Move the file aside to start fresh, or run a migration.`,
    );
  }

  return db;
}

export function readMeta(db: Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value?: string } | undefined;
  return row?.value;
}

export function writeMeta(db: Database, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  );
}

/**
 * A collection of JSON documents in the `entities` table.
 *
 * `seq` preserves insertion order, which the timeline and notification
 * repositories depend on: they are read back newest-last and trimmed oldest
 * first, and a `Map`'s iteration order has to survive a restart for either to
 * behave the same way on the second boot as on the first.
 */
export class EntityTable<T> {
  private readonly insert: StatementSync;
  private readonly delete: StatementSync;
  private readonly selectAll: StatementSync;
  private nextSeq: number;

  constructor(
    private readonly db: Database,
    private readonly collection: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO entities (collection, id, doc, seq) VALUES (?, ?, ?, ?)
       ON CONFLICT(collection, id) DO UPDATE SET doc = excluded.doc`,
    );
    this.delete = db.prepare('DELETE FROM entities WHERE collection = ? AND id = ?');
    this.selectAll = db.prepare('SELECT id, doc FROM entities WHERE collection = ? ORDER BY seq');

    const row = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS top FROM entities WHERE collection = ?')
      .get(this.collection) as { top?: number } | undefined;
    this.nextSeq = Number(row?.top ?? 0) + 1;
  }

  /** Every stored document, in insertion order. Called once, at boot. */
  load(): T[] {
    const rows = this.selectAll.all(this.collection) as { id: string; doc: string }[];
    const out: T[] = [];
    for (const row of rows) {
      try {
        out.push(JSON.parse(row.doc) as T);
      } catch {
        // A corrupt row should cost one entity, not the whole boot.
        console.warn(`[db] skipping unreadable ${this.collection} row ${row.id}`);
      }
    }
    return out;
  }

  put(id: string, entity: T): void {
    this.insert.run(this.collection, id, JSON.stringify(entity), this.nextSeq);
    this.nextSeq += 1;
  }

  remove(id: string): void {
    this.delete.run(this.collection, id);
  }

  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM entities WHERE collection = ?')
      .get(this.collection) as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  }
}
