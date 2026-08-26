import { describe, expect, it } from 'vitest';
import { DeviceStatus } from '@smart-er/core';
import { Store } from '../db/store.js';
import { verifyVehicleIdentity } from './verification.js';

function store() {
  return Store.create({ hardwareSeed: 11 });
}

describe('vehicle verification', () => {
  it('accepts a complete, consistent identity chain', () => {
    const result = verifyVehicleIdentity(store(), 'AMB-01', 'DRV-001');

    expect(result.verified).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.driverAuthorized).toBe(true);
    expect(result.driverLicenceValid).toBe(true);
    expect(result.vehicleActive).toBe(true);
    expect(result.organizationActive).toBe(true);
    expect(result.hardwareRegistered).toBe(true);
    expect(result.hardwareOnline).toBe(true);
  });

  it('rejects a driver who is not authorised for the vehicle', () => {
    // DRV-001 operates AMB-01, not the fire appliance.
    const result = verifyVehicleIdentity(store(), 'FIRE-01', 'DRV-001');

    expect(result.verified).toBe(false);
    expect(result.driverAuthorized).toBe(false);
    expect(result.failures.join(' ')).toContain('not authorised to operate');
  });

  it('rejects an expired operator licence', () => {
    const result = verifyVehicleIdentity(store(), 'AMB-09', 'DRV-009');

    expect(result.verified).toBe(false);
    expect(result.driverLicenceValid).toBe(false);
    expect(result.failures.join(' ')).toContain('expired');
  });

  it('rejects a decommissioned vehicle and a lapsed operator together', () => {
    const result = verifyVehicleIdentity(store(), 'AMB-09', 'DRV-009');

    expect(result.vehicleActive).toBe(false);
    expect(result.organizationActive).toBe(false);
    expect(result.failures.join(' ')).toContain('not in active service');
    expect(result.failures.join(' ')).toContain('is not active');
  });

  it('rejects an unknown vehicle or driver without throwing', () => {
    const unknownVehicle = verifyVehicleIdentity(store(), 'AMB-99', 'DRV-001');
    expect(unknownVehicle.verified).toBe(false);
    expect(unknownVehicle.failures[0]).toContain('not registered');

    const unknownDriver = verifyVehicleIdentity(store(), 'AMB-01', 'DRV-999');
    expect(unknownDriver.verified).toBe(false);
    expect(unknownDriver.failures[0]).toContain('not registered');
  });

  it('rejects a vehicle whose telemetry unit is offline', () => {
    const s = store();
    const vehicle = s.vehicle('AMB-01')!;
    const device = s.device(vehicle.hardwareDeviceId)!;
    s.repositories.devices.put({ ...device, status: DeviceStatus.OFFLINE });

    const result = verifyVehicleIdentity(s, 'AMB-01', 'DRV-001');
    expect(result.verified).toBe(false);
    expect(result.hardwareOnline).toBe(false);
    expect(result.failures.join(' ')).toContain('offline');
  });

  it('rejects a telemetry unit bound to a different vehicle', () => {
    const s = store();
    const vehicle = s.vehicle('AMB-01')!;
    const device = s.device(vehicle.hardwareDeviceId)!;
    s.repositories.devices.put({ ...device, boundEntityId: 'AMB-02' });

    const result = verifyVehicleIdentity(s, 'AMB-01', 'DRV-001');
    expect(result.verified).toBe(false);
    expect(result.hardwareRegistered).toBe(false);
    expect(result.failures.join(' ')).toContain('bound to');
  });

  it('rejects a driver from a different operator than the vehicle', () => {
    const s = store();
    const driver = s.driver('DRV-002')!;
    // Authorise DRV-002 (City Medical Transport) on an ABC Emergency vehicle.
    s.repositories.drivers.put({ ...driver, authorizedVehicleIds: [...driver.authorizedVehicleIds, 'AMB-01'] });

    const result = verifyVehicleIdentity(s, 'AMB-01', 'DRV-002');
    expect(result.verified).toBe(false);
    expect(result.failures.join(' ')).toContain('different operator');
  });
});
