import type { ResponseSample, ServiceStatus } from '@smart-er/core';
import { DeviceStatus, JunctionState, RequestStatus, VehicleStatus } from '@smart-er/core';
import type { Store } from '../db/store.js';

/**
 * What the browser reports about the map provider.
 *
 * Mirrors `MapsHealth` in the web app. The two are separate declarations
 * because the server must not assume the browser is honest or current — an
 * unrecognised value is treated as unknown rather than trusted.
 */
export type MapsHealthReport = 'no-key' | 'loading' | 'ready' | 'unauthorized' | 'error';

export function parseMapsHealth(value: unknown): MapsHealthReport {
  return value === 'ready' || value === 'loading' || value === 'unauthorized' || value === 'error' ? value : 'no-key';
}

const MAPS_STATUS: Record<MapsHealthReport, Pick<ServiceStatus, 'state' | 'detail'>> = {
  ready: { state: 'ONLINE', detail: 'Connected' },
  loading: { state: 'UNKNOWN', detail: 'Connecting…' },
  'no-key': { state: 'UNKNOWN', detail: 'No API key configured — demo map in use' },
  unauthorized: { state: 'OFFLINE', detail: 'API key rejected by Google — demo map in use' },
  error: { state: 'OFFLINE', detail: 'Unreachable — demo map in use' },
};
import { loadResponseHistory, writeResponseHistory } from '../db/persistence.js';
import type { CorridorRuntime } from './corridorRuntime.js';
import type { SimulationEngine } from '../simulation/engine.js';

/**
 * Operational analytics and service health.
 *
 * Both are computed from live state rather than stored as display values. The
 * distinction matters: a dashboard that reports "all systems operational" from
 * a constant is worse than one with no status panel at all, because it actively
 * misleads the person relying on it.
 */
export class AnalyticsService {
  /**
   * Completed runs, keyed by ISO date.
   *
   * Every entry is a run this system actually performed. There is no seeded
   * history: a fabricated fortnight would have made a fresh install look like
   * a system with a track record, and the improvement figure is the number
   * someone would quote to justify the whole project. A new install shows no
   * trend because it has none.
   */
  private readonly history = new Map<string, { runs: number; secondsSaved: number; baselineSeconds: number }>();

  constructor(
    private readonly store: Store,
    private readonly corridors: CorridorRuntime,
    private readonly simulation: SimulationEngine,
  ) {
    this.restore();
  }

  /** Load the trend a previous run left behind, when storage is durable. */
  private restore(): void {
    if (!this.store.db) return;
    for (const row of loadResponseHistory(this.store.db)) {
      this.history.set(row.date, {
        runs: row.runs,
        secondsSaved: row.secondsSaved,
        baselineSeconds: row.baselineSeconds,
      });
    }
  }

  /**
   * Record a completed emergency run.
   *
   * `baselineSeconds` is what the journey would have taken with no corridor —
   * every junction on the route contributing its ordinary delay. `actualSeconds`
   * is what it took. Recording both means the improvement figure is derived,
   * not asserted.
   */
  recordCompletion(baselineSeconds: number, actualSeconds: number, at: Date = new Date()): void {
    if (!Number.isFinite(baselineSeconds) || !Number.isFinite(actualSeconds)) return;
    if (baselineSeconds <= 0 || actualSeconds <= 0) return;

    const key = at.toISOString().slice(0, 10);
    const entry = this.history.get(key) ?? { runs: 0, secondsSaved: 0, baselineSeconds: 0 };
    entry.runs += 1;
    entry.secondsSaved += Math.max(0, baselineSeconds - actualSeconds);
    entry.baselineSeconds += baselineSeconds;
    this.history.set(key, entry);

    if (this.store.db) {
      writeResponseHistory(this.store.db, { date: key, ...entry });
    }
  }

  /** Total completed runs on record. Used to tell "no data" from "0 %". */
  totalRuns(): number {
    let total = 0;
    for (const entry of this.history.values()) total += entry.runs;
    return total;
  }

  /** The last `days` days of response performance, oldest first. */
  responseHistory(days = 7): ResponseSample[] {
    const out: ResponseSample[] = [];
    const today = new Date();

    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      const key = date.toISOString().slice(0, 10);
      const entry = this.history.get(key);

      if (!entry || entry.runs === 0 || entry.baselineSeconds === 0) {
        out.push({ date: key, improvementPercent: 0, completedRuns: 0, averageSecondsSaved: 0 });
        continue;
      }

      out.push({
        date: key,
        improvementPercent: Math.round((entry.secondsSaved / entry.baselineSeconds) * 100),
        completedRuns: entry.runs,
        averageSecondsSaved: Math.round(entry.secondsSaved / entry.runs),
      });
    }
    return out;
  }

  /** Headline figure for the statistics card: the mean over the window. */
  averageImprovementPercent(days = 7): number {
    const samples = this.responseHistory(days).filter((sample) => sample.completedRuns > 0);
    if (samples.length === 0) return 0;
    return Math.round(samples.reduce((total, s) => total + s.improvementPercent, 0) / samples.length);
  }

  /**
   * Live service health.
   *
   * Every entry is derived. If the junction controllers stop responding this
   * reports it, and the dashboard shows a degraded row rather than a green one.
   */
  systemStatus(maps: MapsHealthReport = 'no-key'): ServiceStatus[] {
    const junctions = this.store.graph.junctions;
    const devices = this.store.repositories.devices.list();

    const controllers = devices.filter((device) => device.kind === 'JUNCTION_CONTROLLER');
    const onlineControllers = controllers.filter((device) => device.status === DeviceStatus.ONLINE).length;
    const degradedControllers = controllers.filter((device) => device.status === DeviceStatus.DEGRADED).length;

    const vehicleUnits = devices.filter((device) => device.kind === 'VEHICLE_UNIT');
    const signedOn = this.store.repositories.vehicleStates
      .list()
      .filter((state) => state.status !== VehicleStatus.OFFLINE);
    const gpsOk = signedOn.filter((state) => state.gpsOk).length;

    const junctionsInConflict = this.corridors
      .states()
      .filter((state) => state.state === JunctionState.CONFLICT).length;

    return [
      {
        id: 'junctions',
        label: 'Junction controllers',
        state:
          onlineControllers === controllers.length
            ? 'ONLINE'
            : onlineControllers === 0
              ? 'OFFLINE'
              : 'DEGRADED',
        detail:
          onlineControllers === controllers.length
            ? `All ${controllers.length} online`
            : `${onlineControllers} of ${controllers.length} responding`,
      },
      {
        id: 'gps',
        label: 'GPS tracking',
        state: signedOn.length === 0 ? 'UNKNOWN' : gpsOk === signedOn.length ? 'ONLINE' : 'DEGRADED',
        detail:
          signedOn.length === 0
            ? 'No units signed on'
            : gpsOk === signedOn.length
              ? `${gpsOk} of ${signedOn.length} units locked`
              : `${signedOn.length - gpsOk} unit(s) without a fix`,
      },
      {
        id: 'communication',
        label: 'Communication',
        state: degradedControllers > 0 ? 'DEGRADED' : 'ONLINE',
        detail:
          degradedControllers > 0
            ? `${degradedControllers} controller(s) retrying`
            : `${vehicleUnits.length} units linked`,
      },
      {
        id: 'server',
        label: 'Server',
        state: 'ONLINE',
        detail: `Up ${formatUptime(process.uptime())}`,
      },
      {
        id: 'maps',
        label: 'Google Maps',
        // The server cannot see the browser's key or reach Google on its
        // behalf, so it reports what the browser observed. Note that this is
        // the browser's *outcome*, not its configuration: a key that Google
        // rejects is a failed provider, and reporting it as connected because
        // the variable was set is exactly the lie this panel exists to avoid.
        ...MAPS_STATUS[maps],
      },
      {
        id: 'network',
        label: 'Junction network',
        state: junctionsInConflict > 0 ? 'DEGRADED' : 'ONLINE',
        detail:
          junctionsInConflict > 0
            ? `${junctionsInConflict} junction(s) in conflict`
            : `${junctions.length} junctions modelled`,
      },
      {
        id: 'simulation',
        label: 'Simulation',
        state: this.simulation.state().running ? 'ONLINE' : 'DEGRADED',
        detail: this.simulation.state().running
          ? `Running at ${this.simulation.state().speed}×`
          : 'Paused',
      },
    ];
  }

  /** Counters behind the dashboard's four statistics cards. */
  headline() {
    const vehicles = this.store.repositories.vehicleStates.list();
    const activeEmergencies = vehicles.filter(
      (state) =>
        state.status === VehicleStatus.ACTIVE ||
        state.status === VehicleStatus.REROUTING ||
        state.status === VehicleStatus.REQUESTED,
    ).length;

    const activeCorridors = this.store.activeCorridors().length;

    const controllers = this.store.repositories.devices
      .list()
      .filter((device) => device.kind === 'JUNCTION_CONTROLLER');
    const junctionsOnline = controllers.filter((device) => device.status === DeviceStatus.ONLINE).length;

    const pendingRequests = this.store.repositories.requests.find(
      (request) => request.status === RequestStatus.PENDING,
    ).length;

    return {
      activeEmergencies,
      activeCorridors,
      junctionsOnline,
      junctionsTotal: controllers.length,
      pendingRequests,
      averageImprovementPercent: this.averageImprovementPercent(),
    };
  }

}

function formatUptime(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
