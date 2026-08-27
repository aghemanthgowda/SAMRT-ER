import {
  RoadGraph,
  createSimulatedHardware,
  type Corridor,
  type Driver,
  type Facility,
  type HardwareDevice,
  type Junction,
  type RoadSegment,
  type Route,
  type SimulatedHardwareBundle,
  type Vehicle,
  type VehicleState,
} from '@smart-er/core';
import {
  CorridorStatus,
  DeviceStatus,
  JunctionState,
  SimulationClock,
  VehicleStatus,
  isoNow,
} from '@smart-er/core';
import { buildJunctions, buildRoadSegments } from './network.js';
import type { Repositories } from './repositories.js';
import { buildSeed, type SeedData } from './seed.js';
import {
  createRepositories,
  deletePasswordResets,
  insertPasswordReset,
  loadPasswordResets,
  writeCredential,
} from './persistence.js';
import type { PasswordResetRecord } from '../auth/passwords.js';
import type { Database } from './sqlite.js';

/**
 * The application's single source of truth.
 *
 * Holds the road network, every repository, and the hardware bundle. Services
 * receive this rather than reaching for module-level singletons, so a test can
 * construct an isolated store and exercise the whole stack without a server.
 */
export class Store {
  readonly graph: RoadGraph;
  readonly repositories: Repositories;
  readonly hardware: SimulatedHardwareBundle;
  readonly passwordHashes: Map<string, string>;
  readonly startedAt = isoNow();
  /**
   * The durable store, when there is one.
   *
   * Present only when the server was started against a database file. Services
   * that own data outside the repositories — credentials, response history —
   * check for it; everything else goes through `repositories` and neither
   * knows nor cares whether storage is durable.
   */
  readonly db?: Database;
  /** True when this boot wrote the seed rather than loading an existing store. */
  readonly seeded: boolean;
  private closed = false;
  /**
   * Live password-reset tokens, keyed by the hash of the token.
   *
   * Held in memory for the same reason the repositories are — lookups happen
   * on a request path — and mirrored to storage so a restart does not silently
   * invalidate a link somebody was sent thirty seconds ago.
   */
  private readonly passwordResets = new Map<string, PasswordResetRecord>();
  /**
   * The timebase everything in this store shares.
   *
   * The simulation advances it; signal timing, corridor windows and the
   * timeline all read from it. See `packages/core/src/util/clock.ts` for why
   * this is not simply `Date.now()`.
   */
  readonly clock: SimulationClock;

  private constructor(
    junctions: Junction[],
    segments: RoadSegment[],
    seed: SeedData,
    hardware: SimulatedHardwareBundle,
    clock: SimulationClock,
    databasePath: string | undefined,
  ) {
    this.clock = clock;
    this.graph = new RoadGraph(junctions, segments);
    const problems = this.graph.validate();
    if (problems.length > 0) {
      throw new Error(`Road network failed validation:\n  ${problems.join('\n  ')}`);
    }

    this.hardware = hardware;

    // Junction controllers are hardware too; merge them with the vehicle units.
    const allDevices: HardwareDevice[] = [...seed.devices, ...hardware.status.devices()];
    const deviceById = new Map(allDevices.map((device) => [device.id, device]));

    const persistence = createRepositories(seed, initialVehicleStates(seed), [...deviceById.values()], {
      databasePath,
    });

    this.repositories = persistence.repositories;
    this.passwordHashes = persistence.seeded ? seed.passwordHashes : persistence.passwordHashes;
    this.seeded = persistence.seeded;
    if (persistence.db) this.db = persistence.db;

    if (persistence.db) {
      for (const record of loadPasswordResets(persistence.db)) {
        this.passwordResets.set(record.tokenHash, record);
      }
    }

    if (!persistence.seeded) this.recoverInFlightState();
  }

  static create(options: { hardwareSeed?: number; databasePath?: string | undefined } = {}): Store {
    const junctions = buildJunctions();
    const segments = buildRoadSegments(junctions);
    const seed = buildSeed();
    const clock = new SimulationClock();

    const vehicleDeviceIds = new Map(seed.vehicles.map((vehicle) => [vehicle.id, vehicle.hardwareDeviceId]));
    const hardware = createSimulatedHardware(junctions, vehicleDeviceIds, {
      ...(options.hardwareSeed === undefined ? {} : { seed: options.hardwareSeed }),
      ackFailureRate: 0.01,
      watchdogTimeoutMs: 8000,
      clock,
    });

    return new Store(junctions, segments, seed, hardware, clock, options.databasePath);
  }

  /**
   * Retire anything the previous run left mid-flight.
   *
   * A corridor is a claim on signals that are physically held. The process
   * that held them is gone and this boot has just constructed a fresh hardware
   * bundle with every junction back under normal control, so a stored ACTIVE
   * corridor describes a state that no longer exists anywhere. Restoring it
   * would have the dashboard show greens nobody is holding and the corridor
   * engine try to release junctions it never claimed.
   *
   * The records are kept — they are the run history — but they are closed, and
   * any vehicle they were driving is returned to standby.
   */
  private recoverInFlightState(): void {
    const endedAt = isoNow();

    let closed = 0;

    for (const corridor of this.repositories.corridors.list()) {
      if (corridor.status !== 'ACTIVE' && corridor.status !== 'PENDING') continue;
      this.repositories.corridors.put({
        ...corridor,
        status: CorridorStatus.RELEASED,
        releasedAt: endedAt,
        activeJunctionId: undefined,
        preparingJunctionIds: [],
        releasedJunctionIds: corridor.junctionIds,
        allocations: corridor.allocations.map((allocation) => ({
          ...allocation,
          state: JunctionState.NORMAL,
          releasedAt: allocation.releasedAt ?? endedAt,
        })),
      });
      closed += 1;
    }

    for (const route of this.repositories.routes.list()) {
      if (!route.active) continue;
      this.repositories.routes.put({ ...route, active: false });
    }

    for (const state of this.repositories.vehicleStates.list()) {
      if (state.status === VehicleStatus.OFFLINE) continue;
      this.repositories.vehicleStates.put({
        ...state,
        status: VehicleStatus.OFFLINE,
        speedKph: 0,
        updatedAt: endedAt,
      });
    }

    if (closed > 0) {
      console.warn(
        `[db] closed ${closed} corridor(s) left active by a previous run; junctions are under normal control.`,
      );
    }
  }

  /** Persist a password hash, in memory and — when there is one — on disk. */
  setPasswordHash(userId: string, hash: string): void {
    this.passwordHashes.set(userId, hash);
    if (this.db) writeCredential(this.db, userId, hash);
  }

  // -- password reset tokens -------------------------------------------------

  putPasswordReset(record: PasswordResetRecord): void {
    this.passwordResets.set(record.tokenHash, record);
    if (this.db) insertPasswordReset(this.db, record);
  }

  findPasswordReset(tokenHash: string): PasswordResetRecord | undefined {
    const record = this.passwordResets.get(tokenHash);
    if (!record) return undefined;
    // An expired record is indistinguishable from an absent one to every
    // caller; drop it here so the map does not accumulate dead tokens.
    if (Date.parse(record.expiresAt) <= Date.now()) {
      this.revokePasswordResets(record.userId);
      return undefined;
    }
    return record;
  }

  /** Invalidate every outstanding reset for an account. */
  revokePasswordResets(userId: string): void {
    for (const [hash, record] of this.passwordResets) {
      if (record.userId === userId) this.passwordResets.delete(hash);
    }
    if (this.db) deletePasswordResets(this.db, userId);
  }

  /** Count of live reset tokens. Tests. */
  get outstandingPasswordResets(): number {
    return this.passwordResets.size;
  }

  /**
   * Release the database handle.
   *
   * Idempotent: SIGINT followed by SIGTERM is an ordinary way for a container
   * to stop, and the second close should not be the thing that fails the
   * shutdown.
   */
  close(): void {
    if (!this.db || this.closed) return;
    this.closed = true;
    this.db.close();
  }

  /** Current time on the shared timebase. */
  now(): string {
    return this.clock.iso();
  }

  // -- convenience lookups used across services -----------------------------

  vehicle(vehicleId: string): Vehicle | undefined {
    return this.repositories.vehicles.get(vehicleId);
  }

  vehicleState(vehicleId: string): VehicleState | undefined {
    return this.repositories.vehicleStates.get(vehicleId);
  }

  driver(driverId: string): Driver | undefined {
    return this.repositories.drivers.get(driverId);
  }

  facility(facilityId: string): Facility | undefined {
    return this.repositories.facilities.get(facilityId);
  }

  junction(junctionId: string): Junction | undefined {
    return this.graph.junction(junctionId);
  }

  /** Corridors that are still holding or preparing junctions. */
  activeCorridors(): Corridor[] {
    return this.repositories.corridors.find(
      (corridor) => corridor.status === 'ACTIVE' || corridor.status === 'PENDING',
    );
  }

  activeRoutes(): Route[] {
    return this.repositories.routes.find((route) => route.active);
  }

  device(deviceId: string): HardwareDevice | undefined {
    return this.repositories.devices.get(deviceId);
  }

  isDeviceUsable(deviceId: string): boolean {
    const device = this.repositories.devices.get(deviceId);
    return Boolean(device) && device!.status !== DeviceStatus.OFFLINE;
  }
}

/** Every vehicle starts at its standby post with no driver signed on. */
function initialVehicleStates(seed: SeedData): VehicleState[] {
  const facilityById = new Map(seed.facilities.map((facility) => [facility.id, facility]));
  const now = isoNow();

  return seed.vehicles.map((vehicle) => {
    const base = facilityById.get(vehicle.baseFacilityId);
    return {
      vehicleId: vehicle.id,
      status: VehicleStatus.OFFLINE,
      position: vehicle.standbyPosition ?? base?.position ?? { lat: 12.9746, lng: 77.6094 },
      heading: 0,
      speedKph: 0,
      gpsOk: vehicle.active,
      gpsAccuracy: 8,
      updatedAt: now,
    };
  });
}
