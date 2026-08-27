import bcrypt from 'bcryptjs';
import { validatePassword } from '../auth/passwords.js';
import type {
  Driver,
  Facility,
  HardwareDevice,
  Incident,
  Organization,
  User,
  Vehicle,
} from '@smart-er/core';
import {
  DestinationKind,
  DeviceKind,
  DeviceStatus,
  HardwareMode,
  IncidentKind,
  IncidentStatus,
  Provisioning,
  Role,
  Severity,
  VehicleKind,
  isoNow,
} from '@smart-er/core';

/**
 * Demonstration dataset.
 *
 * Deliberately small enough to hold in your head during a demo, and shaped so
 * every capability in the brief has something to act on: two ambulances from
 * different operators, a fire appliance, two police units, and the facilities
 * that receive them.
 *
 * The seed password is read from SEED_PASSWORD, falling back to a development
 * default. It is hashed with bcrypt before it reaches a repository, is never
 * exported from this module, and is never sent to a client: the API has no
 * endpoint that reveals accounts or credentials. Change it — or replace these
 * accounts entirely — before any deployment that matters.
 */
const SEED_PASSWORD = resolveSeedPassword();

/**
 * The seed password has to satisfy the same policy as a chosen one.
 *
 * Otherwise a weak SEED_PASSWORD produces accounts whose password the
 * change-password endpoint would refuse to accept — which is a strange thing
 * to discover after the accounts already exist. In production a failing value
 * stops the boot; in development it is reported and the default is used, so a
 * typo does not leave someone unable to sign in at all.
 */
function resolveSeedPassword(): string {
  const fallback = 'ChangeMe!2024';
  const configured = process.env.SEED_PASSWORD?.trim();
  if (!configured) return fallback;

  const problem = validatePassword(configured, { email: 'seed@smart-er.example', displayName: 'Seed' });
  if (!problem) return configured;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(`SEED_PASSWORD is not acceptable: ${problem}`);
  }
  console.warn(`[seed] SEED_PASSWORD is not acceptable (${problem}) — using the development default instead.`);
  return fallback;
}

export interface SeedData {
  users: User[];
  organizations: Organization[];
  drivers: Driver[];
  vehicles: Vehicle[];
  facilities: Facility[];
  devices: HardwareDevice[];
  incidents: Incident[];
  /** userId → bcrypt hash. Kept out of the User record so it never serialises. */
  passwordHashes: Map<string, string>;
}

export function buildSeed(): SeedData {
  const now = isoNow();
  const hash = bcrypt.hashSync(SEED_PASSWORD, 10);

  // -- organizations --------------------------------------------------------
  const organizations: Organization[] = [
    {
      id: 'ORG-001',
      name: 'ABC Emergency Services',
      kind: 'AMBULANCE_SERVICE',
      contactNumber: '+91 80 4000 1100',
      licenceNumber: 'KA-EMS-2019-0441',
      active: true,
    },
    {
      id: 'ORG-002',
      name: 'City Medical Transport',
      kind: 'AMBULANCE_SERVICE',
      contactNumber: '+91 80 4000 2200',
      licenceNumber: 'KA-EMS-2021-0873',
      active: true,
    },
    {
      id: 'ORG-003',
      name: 'Bengaluru Fire & Emergency Services',
      kind: 'FIRE_BRIGADE',
      contactNumber: '101',
      licenceNumber: 'KA-FIRE-DIV-04',
      active: true,
    },
    {
      id: 'ORG-004',
      name: 'Bengaluru City Police',
      kind: 'POLICE_DEPARTMENT',
      contactNumber: '100',
      licenceNumber: 'KA-POL-CENTRAL',
      active: true,
    },
    {
      // Present so the controller has something to reject: a lapsed operator.
      id: 'ORG-005',
      name: 'Metro Ambulance Co-operative',
      kind: 'AMBULANCE_SERVICE',
      contactNumber: '+91 80 4000 9900',
      licenceNumber: 'KA-EMS-2016-0210',
      active: false,
    },
  ];

  // -- facilities -----------------------------------------------------------
  const facilities: Facility[] = [
    {
      id: 'FAC-HOSP-01',
      name: 'City General Hospital',
      kind: DestinationKind.HOSPITAL,
      position: { lat: 12.97668, lng: 77.59214 },
      address: 'Ambedkar Veedhi, Sampangi Rama Nagar',
      contactNumber: '+91 80 2670 1000',
      capacity: 12,
      specialities: ['Trauma', 'Cardiac', 'Neuro', 'Burns'],
    },
    {
      id: 'FAC-HOSP-02',
      name: "St. Martha's Hospital",
      kind: DestinationKind.HOSPITAL,
      position: { lat: 12.96594, lng: 77.58873 },
      address: 'Nrupathunga Road, Sampangi Rama Nagar',
      contactNumber: '+91 80 4144 4444',
      capacity: 8,
      specialities: ['Trauma', 'Obstetrics', 'Paediatrics'],
    },
    {
      id: 'FAC-HOSP-03',
      name: 'Bowring & Lady Curzon Hospital',
      kind: DestinationKind.HOSPITAL,
      position: { lat: 12.98301, lng: 77.60797 },
      address: 'Shivajinagar',
      contactNumber: '+91 80 2559 1325',
      capacity: 10,
      specialities: ['Trauma', 'General Surgery'],
    },
    {
      id: 'FAC-FIRE-01',
      name: 'Central Fire Station',
      kind: DestinationKind.FIRE_STATION,
      position: { lat: 12.97831, lng: 77.60663 },
      address: 'Queens Road',
      contactNumber: '101',
      capacity: 4,
    },
    {
      id: 'FAC-POL-01',
      name: 'Central Police Headquarters',
      kind: DestinationKind.POLICE_HQ,
      position: { lat: 12.96842, lng: 77.59346 },
      address: 'Nrupathunga Road',
      contactNumber: '100',
      capacity: 6,
    },
  ];

  // -- vehicles -------------------------------------------------------------
  const vehicles: Vehicle[] = [
    {
      id: 'AMB-01',
      callSign: 'AMB-01',
      kind: VehicleKind.AMBULANCE,
      registrationNumber: 'KA 01 MA 4471',
      organizationId: 'ORG-001',
      hardwareDeviceId: 'HW-AMB-01',
      baseFacilityId: 'FAC-HOSP-01',
      /** Trinity Circle standby post. */
      standbyPosition: { lat: 12.97245, lng: 77.61686 },
      cruisingSpeedKph: 52,
      // The prototype ambulance carries the real ESP32 unit in Phase 2.
      provisioning: Provisioning.PHYSICAL,
      active: true,
    },
    {
      id: 'AMB-02',
      callSign: 'AMB-02',
      kind: VehicleKind.AMBULANCE,
      registrationNumber: 'KA 05 MC 9932',
      organizationId: 'ORG-002',
      hardwareDeviceId: 'HW-AMB-02',
      baseFacilityId: 'FAC-HOSP-02',
      /** Ulsoor Lake standby post. */
      standbyPosition: { lat: 12.98126, lng: 77.61887 },
      cruisingSpeedKph: 50,
      provisioning: Provisioning.SIMULATED,
      active: true,
    },
    {
      id: 'FIRE-01',
      callSign: 'FIRE-01',
      kind: VehicleKind.FIRE_TRUCK,
      registrationNumber: 'KA 01 G 1180',
      organizationId: 'ORG-003',
      hardwareDeviceId: 'HW-FIRE-01',
      baseFacilityId: 'FAC-FIRE-01',
      /** Central Fire Station apron. */
      standbyPosition: { lat: 12.97831, lng: 77.60663 },
      cruisingSpeedKph: 44,
      provisioning: Provisioning.SIMULATED,
      active: true,
    },
    {
      id: 'POL-01',
      callSign: 'POL-01',
      kind: VehicleKind.POLICE_UNIT,
      registrationNumber: 'KA 01 P 7702',
      organizationId: 'ORG-004',
      hardwareDeviceId: 'HW-POL-01',
      baseFacilityId: 'FAC-POL-01',
      /** Police HQ yard. */
      standbyPosition: { lat: 12.96842, lng: 77.59346 },
      cruisingSpeedKph: 58,
      provisioning: Provisioning.SIMULATED,
      active: true,
    },
    {
      id: 'POL-02',
      callSign: 'POL-02',
      kind: VehicleKind.POLICE_UNIT,
      registrationNumber: 'KA 01 P 7719',
      organizationId: 'ORG-004',
      hardwareDeviceId: 'HW-POL-02',
      baseFacilityId: 'FAC-POL-01',
      /** Double Road patrol post. */
      standbyPosition: { lat: 12.96395, lng: 77.60417 },
      cruisingSpeedKph: 58,
      provisioning: Provisioning.SIMULATED,
      active: true,
    },
    {
      // Decommissioned — used to demonstrate verification failure.
      id: 'AMB-09',
      callSign: 'AMB-09',
      kind: VehicleKind.AMBULANCE,
      registrationNumber: 'KA 09 MB 1123',
      organizationId: 'ORG-005',
      hardwareDeviceId: 'HW-AMB-09',
      baseFacilityId: 'FAC-HOSP-02',
      /** Depot. */
      standbyPosition: { lat: 12.96594, lng: 77.58873 },
      cruisingSpeedKph: 48,
      provisioning: Provisioning.SIMULATED,
      active: false,
    },
  ];

  // -- drivers and users ----------------------------------------------------
  const driverSpecs: {
    id: string;
    name: string;
    email: string;
    organizationId: string;
    vehicles: string[];
    licence: string;
    expiryYears: number;
    phone: string;
    active?: boolean;
  }[] = [
    {
      id: 'DRV-001',
      name: 'Ravi Kumar',
      email: 'ravi.kumar@abc-ems.example',
      organizationId: 'ORG-001',
      vehicles: ['AMB-01'],
      licence: 'KA-DL-EV-114872',
      expiryYears: 3,
      phone: '+91 98450 11223',
    },
    {
      id: 'DRV-002',
      name: 'Priya Menon',
      email: 'priya.menon@citymed.example',
      organizationId: 'ORG-002',
      vehicles: ['AMB-02'],
      licence: 'KA-DL-EV-229104',
      expiryYears: 2,
      phone: '+91 98450 44556',
    },
    {
      id: 'DRV-003',
      name: 'Anand Shetty',
      email: 'anand.shetty@bfes.example',
      organizationId: 'ORG-003',
      vehicles: ['FIRE-01'],
      licence: 'KA-DL-EV-330551',
      expiryYears: 4,
      phone: '+91 98450 77889',
    },
    {
      id: 'DRV-004',
      name: 'Meera Nair',
      email: 'meera.nair@bcp.example',
      organizationId: 'ORG-004',
      vehicles: ['POL-01', 'POL-02'],
      licence: 'KA-DL-EV-447203',
      expiryYears: 5,
      phone: '+91 98450 33221',
    },
    {
      // Licence expired last year — verification must catch this.
      id: 'DRV-009',
      name: 'Suresh Rao',
      email: 'suresh.rao@metroamb.example',
      organizationId: 'ORG-005',
      vehicles: ['AMB-09'],
      licence: 'KA-DL-EV-118820',
      expiryYears: -1,
      phone: '+91 98450 66778',
    },
  ];

  const users: User[] = [];
  const drivers: Driver[] = [];
  const passwordHashes = new Map<string, string>();

  for (const spec of driverSpecs) {
    const userId = `USR-${spec.id}`;
    users.push({
      id: userId,
      email: spec.email,
      displayName: spec.name,
      role: Role.DRIVER,
      driverId: spec.id,
      active: spec.active ?? true,
      createdAt: now,
    });
    passwordHashes.set(userId, hash);
    drivers.push({
      id: spec.id,
      userId,
      name: spec.name,
      licenceNumber: spec.licence,
      licenceExpiry: new Date(Date.now() + spec.expiryYears * 365 * 24 * 3600 * 1000).toISOString(),
      organizationId: spec.organizationId,
      authorizedVehicleIds: spec.vehicles,
      phone: spec.phone,
      active: spec.active ?? true,
    });
  }

  const staffSpecs: { id: string; email: string; name: string; role: Role; facilityId?: string; callSign?: string }[] = [
    { id: 'USR-CTRL-01', email: 'controller@smart-er.example', name: 'Controller-01', role: Role.CONTROLLER, callSign: 'CONTROLLER-01' },
    { id: 'USR-CTRL-02', email: 'controller2@smart-er.example', name: 'Controller-02', role: Role.CONTROLLER, callSign: 'CONTROLLER-02' },
    { id: 'USR-ADMIN', email: 'admin@smart-er.example', name: 'System Administrator', role: Role.ADMIN, callSign: 'ADMIN' },
    { id: 'USR-HOSP-01', email: 'ops@citygeneral.example', name: 'City General — Emergency Desk', role: Role.HOSPITAL, facilityId: 'FAC-HOSP-01' },
    { id: 'USR-HOSP-02', email: 'ops@stmarthas.example', name: "St. Martha's — Emergency Desk", role: Role.HOSPITAL, facilityId: 'FAC-HOSP-02' },
    { id: 'USR-HOSP-03', email: 'ops@bowring.example', name: 'Bowring — Emergency Desk', role: Role.HOSPITAL, facilityId: 'FAC-HOSP-03' },
    { id: 'USR-FIRE-01', email: 'watch@bfes.example', name: 'Central Fire Station — Watch Room', role: Role.FIRE_STATION, facilityId: 'FAC-FIRE-01' },
    { id: 'USR-POL-01', email: 'control@bcp.example', name: 'Police HQ — Control Room', role: Role.POLICE, facilityId: 'FAC-POL-01' },
  ];

  for (const spec of staffSpecs) {
    users.push({
      id: spec.id,
      email: spec.email,
      displayName: spec.name,
      role: spec.role,
      ...(spec.facilityId ? { facilityId: spec.facilityId } : {}),
      ...(spec.callSign ? { callSign: spec.callSign } : {}),
      active: true,
      createdAt: now,
    });
    passwordHashes.set(spec.id, hash);
  }

  // -- vehicle hardware units ----------------------------------------------
  const devices: HardwareDevice[] = vehicles.map((vehicle) => ({
    id: vehicle.hardwareDeviceId,
    kind: DeviceKind.VEHICLE_UNIT,
    provisioning: vehicle.provisioning,
    serial: vehicle.hardwareDeviceId,
    mode: HardwareMode.SIMULATED,
    status: vehicle.active ? DeviceStatus.ONLINE : DeviceStatus.OFFLINE,
    firmwareVersion: 'sim-1.0.0',
    boundEntityId: vehicle.id,
    lastHeartbeatAt: now,
    signalStrength: 90,
  }));

  // -- standing incidents ---------------------------------------------------
  const incidents: Incident[] = [
    {
      id: 'INC-1001',
      code: 'FIRE-1001',
      kind: IncidentKind.FIRE,
      severity: Severity.HIGH,
      status: IncidentStatus.REPORTED,
      position: { lat: 12.96731, lng: 77.59054 },
      address: 'Commercial building, Corporation Circle',
      description: 'Smoke reported from second floor of a commercial building. Occupants evacuating.',
      reportedAt: now,
      ownerFacilityId: 'FAC-FIRE-01',
      assignedVehicleIds: [],
    },
    {
      // Positioned so a fire appliance leaving Central Fire Station meets an
      // ambulance running the other way along MG Road — the shared-junction
      // case the conflict engine exists for.
      id: 'INC-1004',
      code: 'FIRE-1004',
      kind: IncidentKind.FIRE,
      severity: Severity.HIGH,
      status: IncidentStatus.REPORTED,
      position: { lat: 12.97245, lng: 77.61686 },
      address: 'Retail block, Trinity Circle, MG Road',
      description: 'Fire on the upper floor of a retail block. Two appliances requested.',
      reportedAt: now,
      ownerFacilityId: 'FAC-FIRE-01',
      assignedVehicleIds: [],
    },
    {
      id: 'INC-1002',
      code: 'POL-1002',
      kind: IncidentKind.LAW_ENFORCEMENT,
      severity: Severity.MEDIUM,
      status: IncidentStatus.REPORTED,
      position: { lat: 12.98387, lng: 77.60524 },
      address: 'Shivajinagar market area',
      description: 'Crowd disturbance reported at the market entrance. Units requested.',
      reportedAt: now,
      ownerFacilityId: 'FAC-POL-01',
      assignedVehicleIds: [],
    },
    {
      id: 'INC-1003',
      code: 'RTA-1003',
      kind: IncidentKind.ROAD_ACCIDENT,
      severity: Severity.CRITICAL,
      status: IncidentStatus.REPORTED,
      position: { lat: 12.96144, lng: 77.59667 },
      address: 'Richmond Circle, Hosur Road approach',
      description: 'Two-vehicle collision. One casualty trapped, ambulance and police requested.',
      reportedAt: now,
      ownerFacilityId: 'FAC-POL-01',
      assignedVehicleIds: [],
    },
  ];

  return { users, organizations, drivers, vehicles, facilities, devices, incidents, passwordHashes };
}
