import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../db/store.js';
import { createContext } from './context.js';
import { parseMapsHealth } from './analytics.js';

/**
 * The improvement percentage is the figure that justifies the system, so what
 * it is allowed to be built from matters more than what it reads.
 */

const opened: Store[] = [];
const dirs: string[] = [];

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-er-analytics-'));
  dirs.push(dir);
  return path.join(dir, 'test.db');
}

function open(databasePath?: string) {
  const store = Store.create({ hardwareSeed: 3, ...(databasePath ? { databasePath } : {}) });
  opened.push(store);
  return { store, context: createContext(store) };
}

afterEach(() => {
  while (opened.length > 0) opened.pop()?.close();
  while (dirs.length > 0) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('response analytics', () => {
  it('reports nothing on a system that has completed nothing', () => {
    const { context } = open();

    expect(context.analytics.totalRuns()).toBe(0);
    expect(context.analytics.averageImprovementPercent()).toBe(0);
    // The window is still returned in full — the chart needs the dates — but
    // every day in it is empty rather than carrying an invented figure.
    expect(context.analytics.responseHistory(7).every((sample) => sample.completedRuns === 0)).toBe(true);
  });

  it('derives the improvement from the runs it was given', () => {
    const { context } = open();

    context.analytics.recordCompletion(600, 400);
    context.analytics.recordCompletion(600, 500);

    // 1200 baseline seconds, 300 saved => 25 %.
    expect(context.analytics.totalRuns()).toBe(2);
    expect(context.analytics.averageImprovementPercent()).toBe(25);
  });

  it('ignores a nonsensical run rather than letting it move the figure', () => {
    const { context } = open();

    context.analytics.recordCompletion(0, 400);
    context.analytics.recordCompletion(600, -1);
    context.analytics.recordCompletion(Number.NaN, 400);

    expect(context.analytics.totalRuns()).toBe(0);
  });

  it('carries real history across a restart', () => {
    const file = tempFile();

    const first = open(file);
    first.context.analytics.recordCompletion(600, 400);
    first.context.analytics.recordCompletion(800, 600);
    const before = first.context.analytics.averageImprovementPercent();
    first.store.close();

    const second = open(file);
    expect(second.context.analytics.totalRuns()).toBe(2);
    expect(second.context.analytics.averageImprovementPercent()).toBe(before);
  });

  it('starts empty on a fresh database rather than inheriting another run', () => {
    const first = open(tempFile());
    first.context.analytics.recordCompletion(600, 400);
    first.store.close();

    const second = open(tempFile());
    expect(second.context.analytics.totalRuns()).toBe(0);
  });
});

/**
 * The map provider row.
 *
 * A key being configured is not the same as Google accepting it, and this
 * panel exists so an operator can trust what it says. Reporting "Connected"
 * over a grey map because an environment variable was set would make the whole
 * panel worthless.
 */
describe('map provider status', () => {
  function mapsRow(maps: Parameters<ReturnType<typeof open>['context']['analytics']['systemStatus']>[0]) {
    const { context } = open();
    return context.analytics.systemStatus(maps).find((row) => row.id === 'maps')!;
  }

  it('reports a rejected key as offline, not as connected', () => {
    const row = mapsRow('unauthorized');
    expect(row.state).toBe('OFFLINE');
    expect(row.detail).toMatch(/rejected/i);
  });

  it('reports an unreachable provider as offline', () => {
    expect(mapsRow('error').state).toBe('OFFLINE');
  });

  it('reports a working provider as online', () => {
    const row = mapsRow('ready');
    expect(row.state).toBe('ONLINE');
    expect(row.detail).toBe('Connected');
  });

  it('reports an unconfigured provider as unknown rather than healthy or broken', () => {
    const row = mapsRow('no-key');
    expect(row.state).toBe('UNKNOWN');
    expect(row.detail).toMatch(/no api key/i);
  });

  it('treats an unrecognised client claim as no key rather than trusting it', () => {
    // The value arrives from a query string, so it is whatever the caller sent.
    expect(parseMapsHealth('definitely-fine')).toBe('no-key');
    expect(parseMapsHealth(true)).toBe('no-key');
    expect(parseMapsHealth(undefined)).toBe('no-key');
    expect(parseMapsHealth('ready')).toBe('ready');
    expect(parseMapsHealth('unauthorized')).toBe('unauthorized');
  });
});
