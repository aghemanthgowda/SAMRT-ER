import {
  RoadGraph,
  createSimulatedHardware,
  type Conflict,
  type Corridor,
  type Driver,
  type EmergencyRequest,
  type Facility,
  type HardwareDevice,
  type Incident,
  type Junction,
  type Notification,
  type Organization,
  type RoadSegment,
  type Route,
  type SignalCommand,
  type SimulatedHardwareBundle,
  type TimelineEvent,
  type User,
  type Vehicle,
  type VehicleState,
} from '@smart-er/core';
import { DeviceStatus, SimulationClock, VehicleStatus, isoNow } from '@smart-er/core';
import { buildJunctions, buildRoadSegments } from './network.js';
import { MemoryRepository, RingRepository, type Repositories } from './repositories.js';
import { buildSeed, type SeedData } from './seed.js';

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
  ) {
    this.clock = clock;
    this.graph = new RoadGraph(junctions, segments);
    const problems = this.graph.validate();
    if (problems.length > 0) {
      throw new Error(`Road network failed validation:\n  ${problems.join('\n  ')}`);
    }

    this.hardware = hardware;
    this.passwordHashes = seed.passwordHashes;

    // Junction controllers are hardware too; merge them with the vehicle units.
    const allDevices: HardwareDevice[] = [...seed.devices, ...hardware.status.devices()];
    const deviceById = new Map(allDevices.map((device) => [device.id, device]));

    this.repositories = {
      users: new MemoryRepository<User>((entity) => entity.id, seed.users),
      organizations: new MemoryRepository<Organization>((entity) => entity.id, seed.organizations),
      drivers: new MemoryRepository<Driver>((entity) => entity.id, seed.drivers),
      vehicles: new MemoryRepository<Vehicle>((entity) => entity.id, seed.vehicles),
      vehicleStates: new MemoryRepository<VehicleState>((entity) => entity.vehicleId, initialVehicleStates(seed)),
      facilities: new MemoryRepository<Facility>((entity) => entity.id, seed.facilities),
      devices: new MemoryRepository<HardwareDevice>((entity) => entity.id, [...deviceById.values()]),
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

  static create(options: { hardwareSeed?: number } = {}): Store {
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

    return new Store(junctions, segments, seed, hardware, clock);
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
