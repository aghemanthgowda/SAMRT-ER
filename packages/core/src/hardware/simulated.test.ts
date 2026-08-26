import { describe, expect, it } from 'vitest';
import { testJunctions } from '../testing/fixtures.js';
import type { SignalCommand } from '../types/domain.js';
import { DeviceStatus, HardwareMode, SignalAspect } from '../types/enums.js';
import { isoNow } from '../util/time.js';
import { SimpleWatchdog, createSimulatedHardware } from './simulated.js';

const junctions = testJunctions();
const vehicleDevices = new Map([
  ['AMB-01', 'HW-AMB-01'],
  ['FIRE-01', 'HW-FIRE-01'],
]);

function build(seed = 7) {
  return createSimulatedHardware(junctions, vehicleDevices, { seed, ackFailureRate: 0 });
}

function command(overrides: Partial<SignalCommand> = {}): SignalCommand {
  return {
    id: 'CMD-1',
    junctionId: 'J2',
    deviceId: 'HW-J2',
    approachId: 'J2-N',
    aspect: SignalAspect.GREEN,
    holdSeconds: 12,
    vehicleId: 'AMB-01',
    issuedAt: isoNow(),
    safetyApproved: true,
    safetyNotes: [],
    ...overrides,
  };
}

describe('simulated hardware', () => {
  it('registers a device for every junction and vehicle', () => {
    const hardware = build();
    expect(hardware.mode).toBe(HardwareMode.SIMULATED);
    const devices = hardware.status.devices();
    expect(devices).toHaveLength(junctions.length + vehicleDevices.size);
    expect(devices.every((device) => device.status === DeviceStatus.ONLINE)).toBe(true);
  });

  it('refuses a command that has not passed the safety validator', async () => {
    const hardware = build();
    await expect(hardware.signals.dispatch(command({ safetyApproved: false }))).rejects.toThrow(
      /safety validator/i,
    );
  });

  it('applies a green and drops conflicting approaches to red', async () => {
    const hardware = build();
    const ack = await hardware.signals.dispatch(command());

    expect(ack.accepted).toBe(true);
    expect(ack.appliedAspect).toBe(SignalAspect.GREEN);
    expect(ack.latencyMs).toBeGreaterThan(0);

    const controller = hardware.signals.get('J2')!;
    const aspects = controller.aspects();
    expect(aspects.get('J2-N')).toBe(SignalAspect.GREEN);
    // J2-N conflicts with J2-E and J2-W in the fixture.
    expect(aspects.get('J2-E')).toBe(SignalAspect.RED);
    expect(aspects.get('J2-W')).toBe(SignalAspect.RED);
  });

  it('is idempotent — re-issuing the current aspect still acknowledges', async () => {
    const hardware = build();
    await hardware.signals.dispatch(command());
    const changedAt = hardware.signals.get('J2')!.lastChangeAt().get('J2-N');

    const ack = await hardware.signals.dispatch(command({ id: 'CMD-2' }));
    expect(ack.accepted).toBe(true);
    // No state change, so the change timestamp must not move.
    expect(hardware.signals.get('J2')!.lastChangeAt().get('J2-N')).toBe(changedAt);
  });

  it('reports an offline controller instead of pretending the green was set', async () => {
    const hardware = build();
    hardware.signals.setJunctionOffline('J2', true);

    const ack = await hardware.signals.dispatch(command());
    expect(ack.accepted).toBe(false);
    expect(ack.appliedAspect).toBe(SignalAspect.FLASHING_RED);
    expect(ack.error).toMatch(/offline/);
    expect(hardware.signals.get('J2')!.status()).toBe(DeviceStatus.OFFLINE);
  });

  it('acknowledges a command for an unknown junction as a failure, not a throw', async () => {
    const hardware = build();
    const ack = await hardware.signals.dispatch(command({ junctionId: 'J99' }));
    expect(ack.accepted).toBe(false);
    expect(ack.error).toMatch(/no controller registered/);
  });

  it('surfaces command rejection when the link is unreliable', async () => {
    const hardware = createSimulatedHardware(junctions, vehicleDevices, { seed: 3, ackFailureRate: 1 });
    const ack = await hardware.signals.dispatch(command());
    expect(ack.accepted).toBe(false);
    expect(ack.error).toMatch(/transient/);
    expect(hardware.signals.get('J2')!.status()).toBe(DeviceStatus.DEGRADED);
  });

  it('publishes GPS fixes with jitter but keeps them near the true position', () => {
    const hardware = build();
    const truth = { lat: 12.9746, lng: 77.6094, heading: 90, speedKph: 42 };
    const fix = hardware.gps.publish('AMB-01', truth);

    expect(fix.valid).toBe(true);
    expect(fix.speedKph).toBe(42);
    expect(Math.abs(fix.position.lat - truth.lat)).toBeLessThan(0.0002);
    expect(Math.abs(fix.position.lng - truth.lng)).toBeLessThan(0.0002);
    expect(hardware.gps.read('AMB-01')).toEqual(fix);
  });

  it('marks a failed receiver invalid and freezes its last known position', () => {
    const hardware = build();
    const truth = { lat: 12.9746, lng: 77.6094, heading: 90, speedKph: 42 };
    const good = hardware.gps.publish('AMB-01', truth);

    hardware.gps.setFailed('AMB-01', true);
    const bad = hardware.gps.publish('AMB-01', { ...truth, lat: 12.99, lng: 77.62 });

    expect(bad.valid).toBe(false);
    expect(bad.speedKph).toBe(0);
    expect(bad.accuracy).toBeGreaterThan(100);
    expect(bad.position).toEqual(good.position);

    hardware.gps.setFailed('AMB-01', false);
    expect(hardware.gps.publish('AMB-01', truth).valid).toBe(true);
  });

  it('delivers telemetry to subscribers through the telemetry provider view', () => {
    const hardware = build();
    const received: string[] = [];
    const unsubscribe = hardware.telemetry.subscribe((telemetry) => received.push(telemetry.vehicleId));

    hardware.gps.publish('AMB-01', { lat: 12.97, lng: 77.61, heading: 0, speedKph: 30 });
    expect(received).toEqual(['AMB-01']);

    unsubscribe();
    hardware.gps.publish('AMB-01', { lat: 12.97, lng: 77.61, heading: 0, speedKph: 30 });
    expect(received).toEqual(['AMB-01']);
  });

  it('raises an emergency-button press with the bound device id', () => {
    const hardware = build();
    const presses: { vehicleId: string; deviceId: string }[] = [];
    hardware.button.onPress((payload) => presses.push(payload));

    hardware.button.press('AMB-01');
    expect(presses).toEqual([expect.objectContaining({ vehicleId: 'AMB-01', deviceId: 'HW-AMB-01' })]);
  });

  it('takes a device offline once the watchdog expires', () => {
    const watchdog = new SimpleWatchdog(1000);
    watchdog.beat('HW-J2', 0);
    expect(watchdog.expired(500)).toEqual([]);
    expect(watchdog.expired(2000)).toEqual(['HW-J2']);

    const hardware = createSimulatedHardware(junctions, vehicleDevices, { seed: 5, watchdogTimeoutMs: 1000 });
    hardware.status.sweep(Date.now() + 5000);
    expect(hardware.status.devices().every((device) => device.status === DeviceStatus.OFFLINE)).toBe(true);

    hardware.status.heartbeat('HW-J2');
    expect(hardware.status.device('HW-J2')!.status).toBe(DeviceStatus.ONLINE);
  });

  it('releases every junction on shutdown', async () => {
    const hardware = build();
    await hardware.signals.dispatch(command());
    await hardware.shutdown();
    expect(hardware.signals.get('J2')!.aspects().get('J2-N')).toBe(SignalAspect.RED);
  });
});
