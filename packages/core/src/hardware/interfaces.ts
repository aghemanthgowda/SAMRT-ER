import type {
  HardwareDevice,
  LatLng,
  SignalAcknowledgement,
  SignalCommand,
  Timestamp,
} from '../types/domain.js';
import type { DeviceStatus, SignalAspect } from '../types/enums.js';

/**
 * Hardware abstraction layer.
 *
 * This file is the single boundary between SMART-ER's decision-making and the
 * physical world. Everything above it — routing, conflict resolution, corridor
 * scheduling, the safety validator — is written against these interfaces and
 * has no idea whether it is talking to a simulator or to an ESP32 on a pole.
 *
 * Phase 1 ships the simulated implementations in this directory.
 * Phase 2 adds ESP32-backed implementations of the *same* interfaces; no engine
 * above this line changes. That is the entire point of the boundary, and it is
 * why the routing engine must never import a transport, a serial port or an
 * MQTT client directly.
 */

// ---------------------------------------------------------------------------
// Telemetry in
// ---------------------------------------------------------------------------

export interface GpsFix {
  position: LatLng;
  /** Degrees clockwise from true north. */
  heading: number;
  speedKph: number;
  /** Reported horizontal accuracy in metres. */
  accuracy: number;
  at: Timestamp;
  /** False when the receiver has no lock — corridors must degrade, not guess. */
  valid: boolean;
}

/** Anything that can report where a vehicle is. */
export interface GpsProvider {
  readonly name: string;
  /** Latest fix, or undefined if the receiver has never locked. */
  read(vehicleId: string): GpsFix | undefined;
  /** Subscribe to fixes as they arrive. Returns an unsubscribe function. */
  subscribe(listener: (vehicleId: string, fix: GpsFix) => void): () => void;
}

export interface VehicleTelemetry {
  vehicleId: string;
  gps: GpsFix;
  /** Emergency light bar / siren engaged. */
  emergencyActive: boolean;
  /** Battery or supply voltage of the on-board unit. */
  supplyVoltage?: number;
  /** Signal strength of the vehicle unit's uplink, 0–100. */
  linkQuality?: number;
  at: Timestamp;
}

/** The on-board unit of an emergency vehicle. */
export interface VehicleTelemetryProvider {
  readonly name: string;
  read(vehicleId: string): VehicleTelemetry | undefined;
  list(): VehicleTelemetry[];
  subscribe(listener: (telemetry: VehicleTelemetry) => void): () => void;
}

/** Physical button in the cab that raises an emergency request. */
export interface EmergencyButton {
  readonly name: string;
  /** Fires when a driver presses the button. */
  onPress(listener: (payload: { vehicleId: string; deviceId: string; at: Timestamp }) => void): () => void;
  /** Test helper / simulator hook. */
  press(vehicleId: string): void;
}

// ---------------------------------------------------------------------------
// Signals out
// ---------------------------------------------------------------------------

/**
 * Drives the signal heads of a single junction.
 *
 * Implementations must be idempotent: re-issuing the aspect a junction is
 * already displaying is a no-op that still acknowledges, because the corridor
 * engine re-asserts state on every tick and the network is unreliable.
 */
export interface JunctionController {
  readonly junctionId: string;
  readonly deviceId: string;
  /** Apply an aspect to one approach. Resolves with the controller's ack. */
  apply(command: SignalCommand): Promise<SignalAcknowledgement>;
  /** Current aspect per approach, as last acknowledged. */
  aspects(): Map<string, SignalAspect>;
  /** When each approach last changed. Used by the safety validator. */
  lastChangeAt(): Map<string, Timestamp>;
  /** Return every approach to its normal public-traffic programme. */
  release(): Promise<void>;
  status(): DeviceStatus;
}

/** Registry of every junction controller in the network. */
export interface SignalController {
  readonly name: string;
  get(junctionId: string): JunctionController | undefined;
  all(): JunctionController[];
  /**
   * Dispatch a safety-approved command. Throws if the command has not been
   * through the safety validator — a deliberate belt-and-braces check, because
   * this is the last software layer before a real traffic light.
   */
  dispatch(command: SignalCommand): Promise<SignalAcknowledgement>;
}

// ---------------------------------------------------------------------------
// Device health
// ---------------------------------------------------------------------------

export interface HardwareStatusProvider {
  readonly name: string;
  devices(): HardwareDevice[];
  device(deviceId: string): HardwareDevice | undefined;
  /**
   * Devices that have missed their heartbeat deadline.
   * A junction whose controller is stale must not be counted on for a green.
   */
  staleDevices(now?: number): HardwareDevice[];
  subscribe(listener: (devices: HardwareDevice[]) => void): () => void;
}

/**
 * Watchdog contract.
 *
 * Junction controllers must prove they are alive. If a controller stops
 * heart-beating, its junction is marked OFFLINE, removed from corridor
 * planning, and — in Phase 2 — the firmware's own watchdog drops the signal to
 * flashing red without waiting to be told.
 */
export interface Watchdog {
  /** Record a heartbeat from a device. */
  beat(deviceId: string, at?: number): void;
  /** Devices whose last beat is older than the timeout. */
  expired(now?: number): string[];
  readonly timeoutMs: number;
}

/**
 * Everything the application needs from hardware, assembled in one place.
 * The server constructs exactly one of these at boot, from configuration, and
 * passes it down. Switching to real hardware is a change to that construction
 * site only.
 */
export interface HardwareBundle {
  readonly mode: import('../types/enums.js').HardwareMode;
  gps: GpsProvider;
  telemetry: VehicleTelemetryProvider;
  signals: SignalController;
  status: HardwareStatusProvider;
  button: EmergencyButton;
  watchdog: Watchdog;
  /** Release everything and stop timers. */
  shutdown(): Promise<void>;
}
