import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CorridorStatus, JunctionState, RequestStatus, Severity, VehicleStatus, isoNow } from '@smart-er/core';
import type { Corridor, EmergencyRequest, Route } from '@smart-er/core';
import { Store } from './store.js';

/**
 * Durability is only worth anything if it survives the process, so these tests
 * open a store against a real file, close it, and open a second one over the
 * same file — which is the thing a restart actually does.
 */

const opened: Store[] = [];
const files: string[] = [];

function tempFile(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'smart-er-db-')), 'test.db');
  files.push(file);
  return file;
}

function open(databasePath: string): Store {
  const store = Store.create({ hardwareSeed: 5, databasePath });
  opened.push(store);
  return store;
}

afterEach(() => {
  while (opened.length > 0) opened.pop()?.close();
  while (files.length > 0) {
    const file = files.pop()!;
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

describe('durable storage', () => {
  it('seeds an empty database once and loads it thereafter', () => {
    const file = tempFile();

    const first = open(file);
    expect(first.seeded).toBe(true);
    const seededUsers = first.repositories.users.list().length;
    expect(seededUsers).toBeGreaterThan(0);
    first.close();

    const second = open(file);
    expect(second.seeded).toBe(false);
    expect(second.repositories.users.list()).toHaveLength(seededUsers);
  });

  it('keeps a record written by a previous run', () => {
    const file = tempFile();

    const first = open(file);
    const request: EmergencyRequest = {
      id: 'REQ-PERSIST-1',
      vehicleId: 'AMB-01',
      driverId: 'DRV-001',
      status: RequestStatus.PENDING,
      severity: Severity.CRITICAL,
      note: 'written before the restart',
      requestedAt: isoNow(),
    };
    first.repositories.requests.put(request);
    first.close();

    const second = open(file);
    expect(second.repositories.requests.get('REQ-PERSIST-1')?.note).toBe('written before the restart');
  });

  it('does not overwrite a changed password with the seed', () => {
    const file = tempFile();

    const first = open(file);
    const user = first.repositories.users.list()[0]!;
    first.setPasswordHash(user.id, '$2b$10$changed-by-the-operator');
    first.close();

    const second = open(file);
    expect(second.passwordHashes.get(user.id)).toBe('$2b$10$changed-by-the-operator');
  });

  it('honours a removal across a restart', () => {
    const file = tempFile();

    const first = open(file);
    const incident = first.repositories.incidents.list()[0]!;
    first.repositories.incidents.remove(incident.id);
    first.close();

    const second = open(file);
    expect(second.repositories.incidents.get(incident.id)).toBeUndefined();
  });

  it('closes a corridor the previous run left holding junctions', () => {
    const file = tempFile();

    const first = open(file);
    const corridor: Corridor = {
      id: 'COR-STALE',
      requestId: 'REQ-STALE',
      vehicleId: 'AMB-01',
      routeId: 'RTE-STALE',
      status: CorridorStatus.ACTIVE,
      junctionIds: ['J1', 'J2'],
      allocations: [
        {
          id: 'ALLOC-1',
          junctionId: 'J1',
          corridorId: 'COR-STALE',
          vehicleId: 'AMB-01',
          approachId: 'J1-E',
          priority: 90,
          startsAt: isoNow(),
          endsAt: isoNow(),
          state: JunctionState.EMERGENCY_GREEN,
          timeSlotted: false,
        },
      ],
      activeJunctionId: 'J1',
      preparingJunctionIds: ['J2'],
      releasedJunctionIds: [],
      createdAt: isoNow(),
    };
    const route: Route = {
      ...(first.repositories.routes.list()[0] ?? ({} as Route)),
      id: 'RTE-STALE',
      vehicleId: 'AMB-01',
      requestId: 'REQ-STALE',
      active: true,
      junctionIds: ['J1', 'J2'],
    } as Route;

    first.repositories.corridors.put(corridor);
    first.repositories.routes.put(route);
    first.repositories.vehicleStates.put({
      ...first.repositories.vehicleStates.get('AMB-01')!,
      status: VehicleStatus.EN_ROUTE,
      speedKph: 44,
    });
    first.close();

    const second = open(file);
    const recovered = second.repositories.corridors.get('COR-STALE')!;

    // The record survives — it is history — but nothing about it still claims
    // a junction, because this process holds none.
    expect(recovered.status).toBe(CorridorStatus.RELEASED);
    expect(recovered.activeJunctionId).toBeUndefined();
    expect(recovered.preparingJunctionIds).toEqual([]);
    expect(recovered.allocations.every((a) => a.state === JunctionState.NORMAL)).toBe(true);
    expect(second.repositories.routes.get('RTE-STALE')?.active).toBe(false);
    expect(second.repositories.vehicleStates.get('AMB-01')?.status).toBe(VehicleStatus.OFFLINE);
  });

  it('restores ring-buffer order so the newest entries stay newest', () => {
    const file = tempFile();

    const first = open(file);
    for (let index = 0; index < 5; index += 1) {
      first.repositories.timeline.put({
        id: `TL-${index}`,
        at: isoNow(),
        kind: 'test.note',
        message: `entry ${index}`,
      });
    }
    first.close();

    const second = open(file);
    const ids = second.repositories.timeline.list().map((entry) => entry.id);
    expect(ids).toEqual(['TL-0', 'TL-1', 'TL-2', 'TL-3', 'TL-4']);
  });

  it('keeps two stores on different files isolated', () => {
    const a = open(tempFile());
    const b = open(tempFile());

    a.repositories.incidents.remove(a.repositories.incidents.list()[0]!.id);
    expect(b.repositories.incidents.list().length).toBeGreaterThan(a.repositories.incidents.list().length);
  });

  it('runs entirely in memory when no path is given', () => {
    const store = Store.create({ hardwareSeed: 5 });
    opened.push(store);
    expect(store.db).toBeUndefined();
    expect(store.seeded).toBe(true);
  });
});
