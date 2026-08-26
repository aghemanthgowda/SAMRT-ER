import type {
  HardwareDevice,
  Junction,
  SignalAcknowledgement,
  SignalCommand,
  Timestamp,
} from '../types/domain.js';
import { DeviceKind, DeviceStatus, HardwareMode, SignalAspect } from '../types/enums.js';
import { SeededRandom } from '../util/random.js';
import { isoNow } from '../util/time.js';
import type {
  EmergencyButton,
  GpsFix,
  GpsProvider,
  HardwareBundle,
  HardwareStatusProvider,
  JunctionController,
  SignalController,
  VehicleTelemetry,
  VehicleTelemetryProvider,
  Watchdog,
} from './interfaces.js';

/**
 * Simulated hardware.
 *
 * These implementations stand in for the ESP32 fleet during Phase 1. They are
 * deliberately not "perfect stubs" — a stub that always succeeds instantly
 * teaches the system nothing about how it behaves when a junction is slow to
 * acknowledge or a GPS receiver loses lock. So they model:
 *
 *   - acknowledgement latency, drawn from a seeded distribution
 *   - occasional command rejection
 *   - heartbeat and watchdog expiry
 *   - GPS dropout and accuracy degradation
 *
 * Every one of those failure modes has a corresponding behaviour in the
 * engines above, and a test that exercises it.
 */

export interface SimulatedHardwareOptions {
  seed?: number;
  /** Mean acknowledgement latency in ms. */
  ackLatencyMs?: number;
  /** Probability a command is rejected and must be retried. */
  ackFailureRate?: number;
  /** Heartbeat interval of simulated devices. */
  heartbeatMs?: number;
  /** How long without a heartbeat before a device is considered offline. */
  watchdogTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Watchdog
// ---------------------------------------------------------------------------

export class SimpleWatchdog implements Watchdog {
  private readonly lastBeat = new Map<string, number>();

  constructor(readonly timeoutMs: number = 6000) {}

  beat(deviceId: string, at: number = Date.now()): void {
    this.lastBeat.set(deviceId, at);
  }

  expired(now: number = Date.now()): string[] {
    const out: string[] = [];
    for (const [deviceId, at] of this.lastBeat) {
      if (now - at > this.timeoutMs) out.push(deviceId);
    }
    return out;
  }

  lastBeatAt(deviceId: string): number | undefined {
    return this.lastBeat.get(deviceId);
  }

  forget(deviceId: string): void {
    this.lastBeat.delete(deviceId);
  }
}

// ---------------------------------------------------------------------------
// Junction controller
// ---------------------------------------------------------------------------

export class SimulatedJunctionController implements JunctionController {
  private readonly aspectByApproach = new Map<string, SignalAspect>();
  private readonly changedAt = new Map<string, Timestamp>();
  private deviceStatus: DeviceStatus = DeviceStatus.ONLINE;
  private forcedOffline = false;

  constructor(
    readonly junctionId: string,
    readonly deviceId: string,
    private readonly junction: Junction,
    private readonly random: SeededRandom,
    private readonly options: Required<Pick<SimulatedHardwareOptions, 'ackLatencyMs' | 'ackFailureRate'>>,
  ) {
    for (const approach of junction.approaches) {
      this.aspectByApproach.set(approach.id, SignalAspect.RED);
      this.changedAt.set(approach.id, isoNow());
    }
  }

  async apply(command: SignalCommand): Promise<SignalAcknowledgement> {
    if (!command.safetyApproved) {
      throw new Error(
        `SimulatedJunctionController: refusing command ${command.id} — it has not passed the safety validator`,
      );
    }

    const latencyMs = Math.round(
      this.random.between(this.options.ackLatencyMs * 0.4, this.options.ackLatencyMs * 1.8),
    );

    if (this.forcedOffline) {
      return {
        commandId: command.id,
        junctionId: this.junctionId,
        deviceId: this.deviceId,
        accepted: false,
        appliedAspect: SignalAspect.FLASHING_RED,
        latencyMs,
        receivedAt: isoNow(),
        error: 'controller offline',
      };
    }

    const rejected = this.random.chance(this.options.ackFailureRate);
    if (rejected) {
      this.deviceStatus = DeviceStatus.DEGRADED;
      return {
        commandId: command.id,
        junctionId: this.junctionId,
        deviceId: this.deviceId,
        accepted: false,
        appliedAspect: this.aspectByApproach.get(command.approachId) ?? SignalAspect.RED,
        latencyMs,
        receivedAt: isoNow(),
        error: 'transient link error; command not applied',
      };
    }

    // Applying a green to one approach drops every conflicting approach to red.
    if (command.aspect === SignalAspect.GREEN) {
      const approach = this.junction.approaches.find((entry) => entry.id === command.approachId);
      for (const conflicting of approach?.conflictsWith ?? []) {
        this.setAspect(conflicting, SignalAspect.RED);
      }
    }
    this.setAspect(command.approachId, command.aspect);
    this.deviceStatus = DeviceStatus.ONLINE;

    return {
      commandId: command.id,
      junctionId: this.junctionId,
      deviceId: this.deviceId,
      accepted: true,
      appliedAspect: command.aspect,
      latencyMs,
      receivedAt: isoNow(),
    };
  }

  aspects(): Map<string, SignalAspect> {
    return new Map(this.aspectByApproach);
  }

  lastChangeAt(): Map<string, Timestamp> {
    return new Map(this.changedAt);
  }

  async release(): Promise<void> {
    for (const approach of this.junction.approaches) {
      this.setAspect(approach.id, SignalAspect.RED);
    }
  }

  status(): DeviceStatus {
    if (this.forcedOffline) return DeviceStatus.OFFLINE;
    return this.deviceStatus;
  }

  /** Simulator hook — take the controller offline to exercise the fallback path. */
  setOffline(offline: boolean): void {
    this.forcedOffline = offline;
    this.deviceStatus = offline ? DeviceStatus.OFFLINE : DeviceStatus.ONLINE;
    if (offline) {
      for (const approach of this.junction.approaches) {
        this.setAspect(approach.id, SignalAspect.FLASHING_RED);
      }
    }
  }

  private setAspect(approachId: string, aspect: SignalAspect): void {
    if (this.aspectByApproach.get(approachId) === aspect) return;
    this.aspectByApproach.set(approachId, aspect);
    this.changedAt.set(approachId, isoNow());
  }
}

// ---------------------------------------------------------------------------
// Signal controller registry
// ---------------------------------------------------------------------------

export class SimulatedSignalController implements SignalController {
  readonly name = 'simulated-signals';
  private readonly controllers = new Map<string, SimulatedJunctionController>();

  constructor(controllers: readonly SimulatedJunctionController[]) {
    for (const controller of controllers) {
      this.controllers.set(controller.junctionId, controller);
    }
  }

  get(junctionId: string): JunctionController | undefined {
    return this.controllers.get(junctionId);
  }

  all(): JunctionController[] {
    return [...this.controllers.values()];
  }

  async dispatch(command: SignalCommand): Promise<SignalAcknowledgement> {
    if (!command.safetyApproved) {
      throw new Error(`SignalController: command ${command.id} was not approved by the safety validator`);
    }
    const controller = this.controllers.get(command.junctionId);
    if (!controller) {
      return {
        commandId: command.id,
        junctionId: command.junctionId,
        deviceId: command.deviceId,
        accepted: false,
        appliedAspect: SignalAspect.FLASHING_RED,
        latencyMs: 0,
        receivedAt: isoNow(),
        error: `no controller registered for junction ${command.junctionId}`,
      };
    }
    return controller.apply(command);
  }

  setJunctionOffline(junctionId: string, offline: boolean): void {
    this.controllers.get(junctionId)?.setOffline(offline);
  }
}

// ---------------------------------------------------------------------------
// GPS + vehicle telemetry
// ---------------------------------------------------------------------------

export class SimulatedGpsProvider implements GpsProvider {
  readonly name = 'simulated-gps';
  private readonly fixes = new Map<string, GpsFix>();
  private readonly telemetry = new Map<string, VehicleTelemetry>();
  private readonly gpsListeners = new Set<(vehicleId: string, fix: GpsFix) => void>();
  private readonly telemetryListeners = new Set<(telemetry: VehicleTelemetry) => void>();
  private readonly failed = new Set<string>();

  constructor(private readonly random: SeededRandom = new SeededRandom()) {}

  read(vehicleId: string): GpsFix | undefined {
    return this.fixes.get(vehicleId);
  }

  list(): VehicleTelemetry[] {
    return [...this.telemetry.values()];
  }

  /** GpsProvider subscription — raw fixes. */
  subscribe(listener: (vehicleId: string, fix: GpsFix) => void): () => void {
    this.gpsListeners.add(listener);
    return () => {
      this.gpsListeners.delete(listener);
    };
  }

  /** VehicleTelemetryProvider subscription — full telemetry frames. */
  subscribeTelemetry(listener: (telemetry: VehicleTelemetry) => void): () => void {
    this.telemetryListeners.add(listener);
    return () => {
      this.telemetryListeners.delete(listener);
    };
  }

  /**
   * View of this provider as a VehicleTelemetryProvider.
   * Kept explicit rather than overloading `subscribe`, so neither interface has
   * to guess which kind of listener it was handed.
   */
  asTelemetryProvider(): VehicleTelemetryProvider {
    return {
      name: `${this.name}-telemetry`,
      read: (vehicleId) => this.telemetry.get(vehicleId),
      list: () => this.list(),
      subscribe: (listener) => this.subscribeTelemetry(listener),
    };
  }

  /**
   * Publish a fix. The simulation calls this every tick with the vehicle's true
   * position; jitter and dropout are applied here so the rest of the system
   * only ever sees realistically imperfect data.
   */
  publish(
    vehicleId: string,
    truth: { lat: number; lng: number; heading: number; speedKph: number },
    opts: { emergencyActive?: boolean } = {},
  ): GpsFix {
    const hasFailed = this.failed.has(vehicleId);
    const jitterM = hasFailed ? 0 : this.random.between(1.5, 6);
    const jitterDeg = jitterM / 111_320;

    const fix: GpsFix = {
      position: hasFailed
        ? (this.fixes.get(vehicleId)?.position ?? { lat: truth.lat, lng: truth.lng })
        : {
            lat: truth.lat + this.random.between(-jitterDeg, jitterDeg),
            lng: truth.lng + this.random.between(-jitterDeg, jitterDeg),
          },
      heading: truth.heading,
      speedKph: hasFailed ? 0 : truth.speedKph,
      accuracy: hasFailed ? 999 : Math.round(jitterM * 2),
      at: isoNow(),
      valid: !hasFailed,
    };

    this.fixes.set(vehicleId, fix);
    const telemetry: VehicleTelemetry = {
      vehicleId,
      gps: fix,
      emergencyActive: opts.emergencyActive ?? false,
      supplyVoltage: Number(this.random.between(12.4, 14.1).toFixed(1)),
      linkQuality: hasFailed ? 0 : Math.round(this.random.between(62, 100)),
      at: fix.at,
    };
    this.telemetry.set(vehicleId, telemetry);

    for (const listener of this.gpsListeners) listener(vehicleId, fix);
    for (const listener of this.telemetryListeners) listener(telemetry);
    return fix;
  }

  /** Simulator hook — drop or restore a receiver's lock. */
  setFailed(vehicleId: string, failed: boolean): void {
    if (failed) this.failed.add(vehicleId);
    else this.failed.delete(vehicleId);
  }

  isFailed(vehicleId: string): boolean {
    return this.failed.has(vehicleId);
  }
}

// ---------------------------------------------------------------------------
// Emergency button
// ---------------------------------------------------------------------------

export class SimulatedEmergencyButton implements EmergencyButton {
  readonly name = 'simulated-button';
  private readonly listeners = new Set<(payload: { vehicleId: string; deviceId: string; at: Timestamp }) => void>();

  constructor(private readonly deviceIdByVehicle: ReadonlyMap<string, string> = new Map()) {}

  onPress(listener: (payload: { vehicleId: string; deviceId: string; at: Timestamp }) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  press(vehicleId: string): void {
    const payload = {
      vehicleId,
      deviceId: this.deviceIdByVehicle.get(vehicleId) ?? `HW-${vehicleId}`,
      at: isoNow(),
    };
    for (const listener of this.listeners) listener(payload);
  }
}

// ---------------------------------------------------------------------------
// Device registry
// ---------------------------------------------------------------------------

export class SimulatedHardwareStatusProvider implements HardwareStatusProvider {
  readonly name = 'simulated-devices';
  private readonly byId = new Map<string, HardwareDevice>();
  private readonly listeners = new Set<(devices: HardwareDevice[]) => void>();

  constructor(
    devices: readonly HardwareDevice[],
    private readonly watchdog: SimpleWatchdog,
  ) {
    for (const device of devices) this.byId.set(device.id, { ...device });
  }

  devices(): HardwareDevice[] {
    return [...this.byId.values()];
  }

  device(deviceId: string): HardwareDevice | undefined {
    return this.byId.get(deviceId);
  }

  staleDevices(now: number = Date.now()): HardwareDevice[] {
    const expired = new Set(this.watchdog.expired(now));
    return this.devices().filter((device) => expired.has(device.id));
  }

  subscribe(listener: (devices: HardwareDevice[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Record a heartbeat and refresh the device's derived status. */
  heartbeat(deviceId: string, patch: Partial<HardwareDevice> = {}): void {
    const device = this.byId.get(deviceId);
    if (!device) return;
    this.watchdog.beat(deviceId);
    this.byId.set(deviceId, {
      ...device,
      ...patch,
      status: patch.status ?? DeviceStatus.ONLINE,
      lastHeartbeatAt: isoNow(),
    });
    this.emit();
  }

  setStatus(deviceId: string, status: DeviceStatus): void {
    const device = this.byId.get(deviceId);
    if (!device) return;
    this.byId.set(deviceId, { ...device, status });
    if (status === DeviceStatus.OFFLINE) this.watchdog.forget(deviceId);
    this.emit();
  }

  /** Re-evaluate every device against the watchdog. Called each tick. */
  sweep(now: number = Date.now()): void {
    const expired = new Set(this.watchdog.expired(now));
    let changed = false;
    for (const [id, device] of this.byId) {
      const shouldBeOffline = expired.has(id);
      if (shouldBeOffline && device.status !== DeviceStatus.OFFLINE) {
        this.byId.set(id, { ...device, status: DeviceStatus.OFFLINE });
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  private emit(): void {
    const snapshot = this.devices();
    for (const listener of this.listeners) listener(snapshot);
  }
}

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

export interface SimulatedHardwareBundle extends HardwareBundle {
  readonly gps: SimulatedGpsProvider;
  readonly signals: SimulatedSignalController;
  readonly status: SimulatedHardwareStatusProvider;
  readonly button: SimulatedEmergencyButton;
  readonly watchdog: SimpleWatchdog;
}

/**
 * Assemble a complete simulated hardware bundle for a junction network.
 *
 * The server calls exactly this at boot in Phase 1. In Phase 2 the equivalent
 * `createEsp32Hardware(...)` returns the same shape, and nothing else changes.
 */
export function createSimulatedHardware(
  junctions: readonly Junction[],
  vehicleDeviceIds: ReadonlyMap<string, string>,
  options: SimulatedHardwareOptions = {},
): SimulatedHardwareBundle {
  const random = new SeededRandom(options.seed ?? 0x5a4e7c31);
  const watchdog = new SimpleWatchdog(options.watchdogTimeoutMs ?? 6000);

  const controllers = junctions.map(
    (junction) =>
      new SimulatedJunctionController(junction.id, junction.hardwareDeviceId, junction, random, {
        ackLatencyMs: options.ackLatencyMs ?? 45,
        ackFailureRate: options.ackFailureRate ?? 0.015,
      }),
  );

  const devices: HardwareDevice[] = [
    ...junctions.map<HardwareDevice>((junction) => ({
      id: junction.hardwareDeviceId,
      kind: DeviceKind.JUNCTION_CONTROLLER,
      serial: junction.hardwareDeviceId,
      mode: HardwareMode.SIMULATED,
      status: DeviceStatus.ONLINE,
      firmwareVersion: 'sim-1.0.0',
      boundEntityId: junction.id,
      lastHeartbeatAt: isoNow(),
      signalStrength: 100,
    })),
    ...[...vehicleDeviceIds.entries()].map<HardwareDevice>(([vehicleId, deviceId]) => ({
      id: deviceId,
      kind: DeviceKind.VEHICLE_UNIT,
      serial: deviceId,
      mode: HardwareMode.SIMULATED,
      status: DeviceStatus.ONLINE,
      firmwareVersion: 'sim-1.0.0',
      boundEntityId: vehicleId,
      lastHeartbeatAt: isoNow(),
      signalStrength: 92,
    })),
  ];

  for (const device of devices) watchdog.beat(device.id);

  const status = new SimulatedHardwareStatusProvider(devices, watchdog);
  const gps = new SimulatedGpsProvider(random);
  const signals = new SimulatedSignalController(controllers);
  const button = new SimulatedEmergencyButton(vehicleDeviceIds);

  return {
    mode: HardwareMode.SIMULATED,
    gps,
    telemetry: gps.asTelemetryProvider(),
    signals,
    status,
    button,
    watchdog,
    async shutdown() {
      await Promise.all(signals.all().map((controller) => controller.release()));
    },
  };
}
