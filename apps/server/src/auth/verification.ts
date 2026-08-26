import type { VehicleVerification } from '@smart-er/core';
import { DeviceStatus, isoNow } from '@smart-er/core';
import type { Store } from '../db/store.js';

/**
 * Vehicle verification.
 *
 * Selecting "ambulance driver" on a login screen must never be enough to win a
 * green corridor — a corridor stops cross-traffic on live roads. Authority to
 * request one comes from a chain that has to hold at every link:
 *
 *   Driver → authorised for this Vehicle
 *   Vehicle → belongs to an active Organization
 *   Organization → holds a current operating licence
 *   HardwareDevice → registered to this vehicle and currently reachable
 *
 * Every check is reported individually rather than as a single boolean, because
 * the controller is shown exactly which link failed before deciding.
 */
export function verifyVehicleIdentity(store: Store, vehicleId: string, driverId: string): VehicleVerification {
  const failures: string[] = [];

  const vehicle = store.repositories.vehicles.get(vehicleId);
  const driver = store.repositories.drivers.get(driverId);

  if (!vehicle) {
    return {
      verified: false,
      checkedAt: isoNow(),
      driverAuthorized: false,
      driverLicenceValid: false,
      vehicleActive: false,
      organizationActive: false,
      hardwareRegistered: false,
      hardwareOnline: false,
      failures: [`Vehicle ${vehicleId} is not registered with SMART-ER.`],
    };
  }
  if (!driver) {
    return {
      verified: false,
      checkedAt: isoNow(),
      driverAuthorized: false,
      driverLicenceValid: false,
      vehicleActive: vehicle.active,
      organizationActive: false,
      hardwareRegistered: false,
      hardwareOnline: false,
      failures: [`Driver ${driverId} is not registered with SMART-ER.`],
    };
  }

  // -- driver → vehicle ----------------------------------------------------
  const driverAuthorized = driver.active && driver.authorizedVehicleIds.includes(vehicle.id);
  if (!driver.active) {
    failures.push(`Driver ${driver.id} (${driver.name}) is not an active operator.`);
  } else if (!driver.authorizedVehicleIds.includes(vehicle.id)) {
    failures.push(`Driver ${driver.id} is not authorised to operate ${vehicle.callSign}.`);
  }

  // -- driver licence ------------------------------------------------------
  const licenceValid = new Date(driver.licenceExpiry).getTime() > Date.now();
  if (!licenceValid) {
    failures.push(
      `Driver licence ${driver.licenceNumber} expired on ${new Date(driver.licenceExpiry).toLocaleDateString()}.`,
    );
  }

  // -- vehicle -------------------------------------------------------------
  if (!vehicle.active) {
    failures.push(`Vehicle ${vehicle.callSign} (${vehicle.registrationNumber}) is not in active service.`);
  }

  // -- organization --------------------------------------------------------
  const organization = store.repositories.organizations.get(vehicle.organizationId);
  const organizationActive = Boolean(organization?.active);
  if (!organization) {
    failures.push(`Vehicle ${vehicle.callSign} is not linked to a registered operator.`);
  } else if (!organization.active) {
    failures.push(`Operator ${organization.name} (licence ${organization.licenceNumber}) is not active.`);
  } else if (driver.organizationId !== organization.id) {
    failures.push(
      `Driver ${driver.id} belongs to a different operator than ${vehicle.callSign}. Identity chain is inconsistent.`,
    );
  }

  // -- hardware ------------------------------------------------------------
  const device = store.repositories.devices.get(vehicle.hardwareDeviceId);
  const hardwareRegistered = Boolean(device) && device!.boundEntityId === vehicle.id;
  if (!device) {
    failures.push(`No telemetry unit is registered for ${vehicle.callSign}.`);
  } else if (device.boundEntityId !== vehicle.id) {
    failures.push(`Telemetry unit ${device.serial} is bound to ${device.boundEntityId}, not ${vehicle.callSign}.`);
  }
  const hardwareOnline = Boolean(device) && device!.status !== DeviceStatus.OFFLINE;
  if (device && device.status === DeviceStatus.OFFLINE) {
    failures.push(`Telemetry unit ${device.serial} is offline; live position cannot be confirmed.`);
  }

  const driverBelongsToOrg = !organization || driver.organizationId === organization.id;

  return {
    verified:
      driverAuthorized &&
      licenceValid &&
      vehicle.active &&
      organizationActive &&
      driverBelongsToOrg &&
      hardwareRegistered &&
      hardwareOnline,
    checkedAt: isoNow(),
    driverAuthorized,
    driverLicenceValid: licenceValid,
    vehicleActive: vehicle.active,
    organizationActive: organizationActive && driverBelongsToOrg,
    hardwareRegistered,
    hardwareOnline,
    failures,
  };
}

/** Full identity chain for the controller's verification panel. */
export function vehicleIdentity(store: Store, vehicleId: string) {
  const vehicle = store.repositories.vehicles.get(vehicleId);
  if (!vehicle) return undefined;
  const organization = store.repositories.organizations.get(vehicle.organizationId);
  const device = store.repositories.devices.get(vehicle.hardwareDeviceId);
  const baseFacility = store.repositories.facilities.get(vehicle.baseFacilityId);
  const drivers = store.repositories.drivers.find((driver) => driver.authorizedVehicleIds.includes(vehicle.id));

  return { vehicle, organization, device, baseFacility, authorizedDrivers: drivers };
}
