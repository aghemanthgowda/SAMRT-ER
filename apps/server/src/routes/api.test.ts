import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { Severity } from '@smart-er/core';
import { createApp } from '../app.js';
import { Store } from '../db/store.js';
import { createContext, type AppContext } from '../services/context.js';

/**
 * The password the seed hashes. Set here rather than imported, because the
 * application deliberately does not export it — nothing outside the seed
 * should be able to reach a credential.
 */
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe!2024';

let context: AppContext;
let app: ReturnType<typeof createApp>;

async function tokenFor(email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: SEED_PASSWORD });
  expect(response.status).toBe(200);
  return response.body.token as string;
}

beforeEach(() => {
  const store = Store.create({ hardwareSeed: 77 });
  context = createContext(store);
  app = createApp(context);
});

describe('authentication', () => {
  it('issues a token for valid credentials and returns the driver context', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ravi.kumar@abc-ems.example', password: SEED_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeTypeOf('string');
    expect(response.body.user.role).toBe('DRIVER');
    expect(response.body.driver.id).toBe('DRV-001');
    expect(response.body.vehicles.map((v: { id: string }) => v.id)).toEqual(['AMB-01']);
  });

  it('never reveals whether an address exists', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ravi.kumar@abc-ems.example', password: 'not-the-password' });
    const unknownAddress = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: SEED_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAddress.status).toBe(401);
    expect(wrongPassword.body.error).toBe(unknownAddress.body.error);
  });

  it('never returns a password hash', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ravi.kumar@abc-ems.example', password: SEED_PASSWORD });

    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/\$2[aby]\$/);
    expect(body).not.toMatch(/passwordHash/i);
  });

  it('refuses protected endpoints without a token', async () => {
    for (const path of ['/api/snapshot', '/api/vehicles', '/api/requests', '/api/network']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  it('refuses a malformed token', async () => {
    const response = await request(app).get('/api/snapshot').set('authorization', 'Bearer not-a-token');
    expect(response.status).toBe(401);
  });
});

describe('authorization', () => {
  it('stops a driver approving their own request', async () => {
    const driverToken = await tokenFor('ravi.kumar@abc-ems.example');

    await request(app).post('/api/driver/sign-on').set('authorization', `Bearer ${driverToken}`).send({ vehicleId: 'AMB-01' });
    const created = await request(app)
      .post('/api/requests')
      .set('authorization', `Bearer ${driverToken}`)
      .send({ vehicleId: 'AMB-01', severity: Severity.CRITICAL, destinationFacilityId: 'FAC-HOSP-01' });
    expect(created.status).toBe(201);

    const approval = await request(app)
      .post(`/api/requests/${created.body.id}/approve`)
      .set('authorization', `Bearer ${driverToken}`)
      .send({});
    expect(approval.status).toBe(403);
  });

  it('stops a driver acting on a vehicle they are not authorised for', async () => {
    const driverToken = await tokenFor('ravi.kumar@abc-ems.example');
    const response = await request(app)
      .post('/api/driver/sign-on')
      .set('authorization', `Bearer ${driverToken}`)
      .send({ vehicleId: 'FIRE-01' });

    expect(response.status).toBe(403);
  });

  it('stops a hospital account starting a simulation scenario', async () => {
    const hospitalToken = await tokenFor('ops@citygeneral.example');
    const response = await request(app)
      .post('/api/simulation/scenario')
      .set('authorization', `Bearer ${hospitalToken}`)
      .send({ scenarioId: 'single-ambulance' });

    expect(response.status).toBe(403);
  });
});

describe('request lifecycle over HTTP', () => {
  it('carries a request from submission to approval with a route and corridor', async () => {
    const driverToken = await tokenFor('ravi.kumar@abc-ems.example');
    const controllerToken = await tokenFor('controller@smart-er.example');

    await request(app).post('/api/driver/sign-on').set('authorization', `Bearer ${driverToken}`).send({ vehicleId: 'AMB-01' });

    const created = await request(app)
      .post('/api/requests')
      .set('authorization', `Bearer ${driverToken}`)
      .send({
        vehicleId: 'AMB-01',
        severity: Severity.CRITICAL,
        destinationFacilityId: 'FAC-HOSP-01',
        note: 'Cardiac arrest, 62M',
      });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('PENDING');

    const approved = await request(app)
      .post(`/api/requests/${created.body.id}/approve`)
      .set('authorization', `Bearer ${controllerToken}`)
      .send({});

    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.routeId).toBeDefined();
    expect(approved.body.corridorId).toBeDefined();
    expect(approved.body.verification.verified).toBe(true);

    const detail = await request(app)
      .get(`/api/requests/${created.body.id}`)
      .set('authorization', `Bearer ${controllerToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.route.junctionIds.length).toBeGreaterThan(0);
    expect(detail.body.route.explanation).toBeTypeOf('string');
    expect(detail.body.identity.organization.name).toBe('ABC Emergency Services');
    expect(detail.body.timeline.length).toBeGreaterThan(0);
  });

  it('lets a crew return to standby after arriving so they can take another call', async () => {
    const driverToken = await tokenFor('ravi.kumar@abc-ems.example');
    const controllerToken = await tokenFor('controller@smart-er.example');

    await request(app).post('/api/driver/sign-on').set('authorization', `Bearer ${driverToken}`).send({ vehicleId: 'AMB-01' });
    const created = await request(app)
      .post('/api/requests')
      .set('authorization', `Bearer ${driverToken}`)
      .send({ vehicleId: 'AMB-01', severity: Severity.CRITICAL, destinationFacilityId: 'FAC-HOSP-01' });
    await request(app)
      .post(`/api/requests/${created.body.id}/approve`)
      .set('authorization', `Bearer ${controllerToken}`)
      .send({});

    // Run the vehicle to its destination.
    context.simulation.stop();
    context.simulation.setSpeed(8);
    for (let i = 0; i < 200; i += 1) {
      await context.simulation.tick();
      if (context.store.vehicleState('AMB-01')?.status === 'ARRIVED') break;
    }
    expect(context.store.vehicleState('AMB-01')!.status).toBe('ARRIVED');

    const standby = await request(app)
      .post('/api/driver/standby')
      .set('authorization', `Bearer ${driverToken}`)
      .send({ vehicleId: 'AMB-01' });

    expect(standby.status).toBe(200);
    expect(standby.body.status).toBe('STANDBY');
    expect(standby.body.activeRequestId).toBeUndefined();

    // And the unit can immediately take another call.
    const second = await request(app)
      .post('/api/requests')
      .set('authorization', `Bearer ${driverToken}`)
      .send({ vehicleId: 'AMB-01', severity: Severity.HIGH, destinationFacilityId: 'FAC-HOSP-02' });
    expect(second.status).toBe(201);
  });

  it('refuses to return a running unit to standby', async () => {
    const driverToken = await tokenFor('ravi.kumar@abc-ems.example');
    await request(app).post('/api/driver/sign-on').set('authorization', `Bearer ${driverToken}`).send({ vehicleId: 'AMB-01' });

    const response = await request(app)
      .post('/api/driver/standby')
      .set('authorization', `Bearer ${driverToken}`)
      .send({ vehicleId: 'AMB-01' });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/cannot return to standby/i);
  });

  it('rejects a request with no destination', async () => {
    const driverToken = await tokenFor('ravi.kumar@abc-ems.example');
    await request(app).post('/api/driver/sign-on').set('authorization', `Bearer ${driverToken}`).send({ vehicleId: 'AMB-01' });

    const response = await request(app)
      .post('/api/requests')
      .set('authorization', `Bearer ${driverToken}`)
      .send({ vehicleId: 'AMB-01', severity: Severity.CRITICAL });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/not valid/i);
  });

  it('records a controller rejection with its reason', async () => {
    const driverToken = await tokenFor('ravi.kumar@abc-ems.example');
    const controllerToken = await tokenFor('controller@smart-er.example');

    await request(app).post('/api/driver/sign-on').set('authorization', `Bearer ${driverToken}`).send({ vehicleId: 'AMB-01' });
    const created = await request(app)
      .post('/api/requests')
      .set('authorization', `Bearer ${driverToken}`)
      .send({ vehicleId: 'AMB-01', severity: Severity.LOW, destinationFacilityId: 'FAC-HOSP-01' });

    const rejected = await request(app)
      .post(`/api/requests/${created.body.id}/reject`)
      .set('authorization', `Bearer ${controllerToken}`)
      .send({ reason: 'Non-urgent transfer; use normal traffic.' });

    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.rejectionReason).toMatch(/Non-urgent/);
  });
});

describe('Google Maps geometry hand-back', () => {
  it('adopts a browser-supplied route polyline for an existing route', async () => {
    const driverToken = await tokenFor('ravi.kumar@abc-ems.example');
    const controllerToken = await tokenFor('controller@smart-er.example');

    await request(app).post('/api/driver/sign-on').set('authorization', `Bearer ${driverToken}`).send({ vehicleId: 'AMB-01' });
    const created = await request(app)
      .post('/api/requests')
      .set('authorization', `Bearer ${driverToken}`)
      .send({ vehicleId: 'AMB-01', severity: Severity.CRITICAL, destinationFacilityId: 'FAC-HOSP-01' });
    const approved = await request(app)
      .post(`/api/requests/${created.body.id}/approve`)
      .set('authorization', `Bearer ${controllerToken}`)
      .send({});

    const path = [
      { lat: 12.97245, lng: 77.61686 },
      { lat: 12.9748, lng: 77.6131 },
      { lat: 12.97463, lng: 77.60946 },
      { lat: 12.97668, lng: 77.59214 },
    ];

    const response = await request(app)
      .post(`/api/routes/${approved.body.routeId}/geometry`)
      .set('authorization', `Bearer ${controllerToken}`)
      .send({ path, distanceM: 3400, etaSeconds: 260, source: 'GOOGLE_ROUTES' });

    expect(response.status).toBe(200);
    expect(response.body.source).toBe('GOOGLE_ROUTES');
    expect(response.body.path).toHaveLength(4);
    expect(response.body.etaSeconds).toBe(260);
    // Junction sequencing is SMART-ER's own and must survive the hand-back:
    // Google supplies geometry and travel time, never which junctions to hold.
    const before = await request(app)
      .get(`/api/requests/${created.body.id}`)
      .set('authorization', `Bearer ${controllerToken}`);
    expect(response.body.junctionIds).toEqual(before.body.route.junctionIds);
    expect(response.body.junctionIds.length).toBeGreaterThan(0);
  });

  it('refuses geometry with fewer than two points', async () => {
    const controllerToken = await tokenFor('controller@smart-er.example');
    const response = await request(app)
      .post('/api/routes/RTE-NOPE/geometry')
      .set('authorization', `Bearer ${controllerToken}`)
      .send({ path: [{ lat: 12.97, lng: 77.6 }] });

    expect(response.status).toBe(400);
  });
});

describe('reference and operational endpoints', () => {
  it('serves the junction network', async () => {
    const token = await tokenFor('controller@smart-er.example');
    const response = await request(app).get('/api/network').set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.junctions.length).toBeGreaterThan(10);
    expect(response.body.roadSegments.length).toBeGreaterThan(20);
    expect(response.body.junctionStates.length).toBe(response.body.junctions.length);
  });

  it('serves a complete operational snapshot', async () => {
    const token = await tokenFor('controller@smart-er.example');
    const response = await request(app).get('/api/snapshot').set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    for (const key of [
      'vehicles',
      'requests',
      'routes',
      'corridors',
      'conflicts',
      'incidents',
      'junctions',
      'junctionStates',
      'roadSegments',
      'devices',
      'impact',
      'timeline',
      'simulation',
    ]) {
      expect(response.body, `snapshot is missing ${key}`).toHaveProperty(key);
    }
  });

  it('reports the vehicle identity chain for the controller verification panel', async () => {
    const token = await tokenFor('controller@smart-er.example');
    const response = await request(app).get('/api/vehicles/AMB-01/identity').set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.vehicle.callSign).toBe('AMB-01');
    expect(response.body.organization.licenceNumber).toBeTypeOf('string');
    expect(response.body.device.serial).toBe('HW-AMB-01');
    expect(response.body.authorizedDrivers.length).toBeGreaterThan(0);
  });

  it('creates an incident and assigns a unit to it', async () => {
    const fireToken = await tokenFor('watch@bfes.example');

    const incident = await request(app)
      .post('/api/incidents')
      .set('authorization', `Bearer ${fireToken}`)
      .send({
        kind: 'FIRE',
        severity: Severity.HIGH,
        position: { lat: 12.9673, lng: 77.5905 },
        address: 'Warehouse, Corporation Circle',
        description: 'Smoke reported from a warehouse loading bay.',
      });
    expect(incident.status).toBe(201);

    const assigned = await request(app)
      .post(`/api/incidents/${incident.body.id}/assign`)
      .set('authorization', `Bearer ${fireToken}`)
      .send({ vehicleId: 'FIRE-01' });

    expect(assigned.status).toBe(201);
    expect(assigned.body.incident.assignedVehicleIds).toContain('FIRE-01');
    expect(assigned.body.request.status).toBe('PENDING');
  });

  it('reset genuinely restores the network so a scenario can be re-run', async () => {
    const driverToken = await tokenFor('ravi.kumar@abc-ems.example');
    const controllerToken = await tokenFor('controller@smart-er.example');

    const before = context.store.vehicleState('AMB-01')!.position;

    // Run AMB-01 somewhere and inject a fault along the way.
    await request(app).post('/api/driver/sign-on').set('authorization', `Bearer ${driverToken}`).send({ vehicleId: 'AMB-01' });
    const created = await request(app)
      .post('/api/requests')
      .set('authorization', `Bearer ${driverToken}`)
      .send({ vehicleId: 'AMB-01', severity: Severity.CRITICAL, destinationFacilityId: 'FAC-HOSP-01' });
    await request(app)
      .post(`/api/requests/${created.body.id}/approve`)
      .set('authorization', `Bearer ${controllerToken}`)
      .send({});
    await request(app)
      .post('/api/simulation/fault')
      .set('authorization', `Bearer ${controllerToken}`)
      .send({ kind: 'junction', targetId: 'J3', enabled: true });
    await request(app)
      .post('/api/simulation/fault')
      .set('authorization', `Bearer ${controllerToken}`)
      .send({ kind: 'road', targetId: 'J1-J2', enabled: true });

    context.simulation.stop();
    context.simulation.setSpeed(8);
    for (let i = 0; i < 60; i += 1) await context.simulation.tick();
    expect(context.store.vehicleState('AMB-01')!.position).not.toEqual(before);

    const reset = await request(app)
      .post('/api/simulation/reset')
      .set('authorization', `Bearer ${controllerToken}`)
      .send({});
    expect(reset.status).toBe(200);

    // The unit is back at its standby post and offline, ready for a fresh run.
    const state = context.store.vehicleState('AMB-01')!;
    expect(state.position).toEqual(before);
    expect(state.status).toBe('OFFLINE');
    expect(state.activeRouteId).toBeUndefined();
    expect(state.corridorId).toBeUndefined();

    // Roads reopened, traffic normal, controllers back online.
    expect(context.store.graph.segments.every((segment) => !segment.blocked)).toBe(true);
    expect(context.store.repositories.devices.list().every((device) => device.status === 'ONLINE')).toBe(true);
    expect(context.store.activeCorridors()).toHaveLength(0);
    expect(context.store.repositories.conflicts.list()).toHaveLength(0);
  });

  it('lists the simulation scenarios with their expected outcomes', async () => {
    const token = await tokenFor('controller@smart-er.example');
    const response = await request(app).get('/api/simulation').set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.scenarios.length).toBeGreaterThanOrEqual(8);
    for (const scenario of response.body.scenarios) {
      expect(scenario.expectedOutcome).toBeTypeOf('string');
      expect(scenario.steps.length).toBeGreaterThan(0);
    }
  });

  it('no longer exposes any endpoint that lists accounts or credentials', async () => {
    const token = await tokenFor('controller@smart-er.example');
    // Removed deliberately: an endpoint that enumerates accounts is an
    // information-disclosure surface, authenticated or not.
    for (const path of ['/api/auth/demo-accounts', '/api/users', '/api/accounts']) {
      const anonymous = await request(app).get(path);
      const authenticated = await request(app).get(path).set('authorization', `Bearer ${token}`);
      expect(anonymous.status).toBe(404);
      expect(authenticated.status).toBe(404);
    }
  });

  it('serves the dashboard summary entirely from derived state', async () => {
    const token = await tokenFor('controller@smart-er.example');
    const response = await request(app)
      .get('/api/dashboard?maps=false&days=7')
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const { headline, systemStatus, responseHistory } = response.body;

    expect(headline.junctionsTotal).toBeGreaterThan(10);
    expect(headline.junctionsOnline).toBe(headline.junctionsTotal);
    expect(headline.activeEmergencies).toBe(0);
    expect(headline.activeCorridors).toBe(0);

    expect(responseHistory).toHaveLength(7);
    for (const sample of responseHistory) {
      expect(sample.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(sample.improvementPercent).toBeGreaterThanOrEqual(0);
      expect(sample.improvementPercent).toBeLessThanOrEqual(100);
    }

    // Every service reports a real state, and Maps is honest about not knowing.
    const byId = Object.fromEntries(systemStatus.map((s: { id: string }) => [s.id, s]));
    expect(byId.junctions.state).toBe('ONLINE');
    expect(byId.maps.state).toBe('UNKNOWN');
    expect(byId.maps.detail).toMatch(/No API key/);
  });

  it('reports Google Maps as online only when the client says it actually loaded', async () => {
    const token = await tokenFor('controller@smart-er.example');
    const response = await request(app).get('/api/system-status?maps=ready').set('authorization', `Bearer ${token}`);

    const maps = response.body.find((service: { id: string }) => service.id === 'maps');
    expect(maps.state).toBe('ONLINE');
    expect(maps.detail).toBe('Connected');
  });

  it('reports a rejected Maps key as offline rather than connected', async () => {
    const token = await tokenFor('controller@smart-er.example');
    const response = await request(app)
      .get('/api/system-status?maps=unauthorized')
      .set('authorization', `Bearer ${token}`);

    // A key being configured is not the same as Google accepting it. Reporting
    // this row green would tell the operator the map works while they look at
    // an empty grey panel.
    const maps = response.body.find((service: { id: string }) => service.id === 'maps');
    expect(maps.state).toBe('OFFLINE');
    expect(maps.detail).toMatch(/rejected/i);
  });

  it('degrades the junction status when a controller goes offline', async () => {
    const token = await tokenFor('controller@smart-er.example');

    await request(app)
      .post('/api/simulation/fault')
      .set('authorization', `Bearer ${token}`)
      .send({ kind: 'junction', targetId: 'J3', enabled: true });

    const response = await request(app).get('/api/system-status?maps=false').set('authorization', `Bearer ${token}`);
    const junctions = response.body.find((service: { id: string }) => service.id === 'junctions');

    expect(junctions.state).toBe('DEGRADED');
    expect(junctions.detail).toMatch(/responding/);
  });

  it('derives alerts from the real incident timeline', async () => {
    const driverToken = await tokenFor('ravi.kumar@abc-ems.example');
    const controllerToken = await tokenFor('controller@smart-er.example');

    await request(app).post('/api/driver/sign-on').set('authorization', `Bearer ${driverToken}`).send({ vehicleId: 'AMB-01' });
    const created = await request(app)
      .post('/api/requests')
      .set('authorization', `Bearer ${driverToken}`)
      .send({ vehicleId: 'AMB-01', severity: Severity.CRITICAL, destinationFacilityId: 'FAC-HOSP-01' });
    await request(app)
      .post(`/api/requests/${created.body.id}/approve`)
      .set('authorization', `Bearer ${controllerToken}`)
      .send({});

    const response = await request(app).get('/api/alerts?limit=20').set('authorization', `Bearer ${controllerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
    for (const alert of response.body) {
      expect(['critical', 'warning', 'info']).toContain(alert.severity);
      expect(alert.message.length).toBeGreaterThan(10);
      expect(alert.at).toBeTypeOf('string');
    }
    // Arming a corridor is a real event and must appear.
    expect(response.body.some((alert: { kind: string }) => alert.kind === 'corridor.activated')).toBe(true);
  });

  it('reports which vehicles and junctions are physical rather than simulated', async () => {
    const token = await tokenFor('controller@smart-er.example');

    const vehicles = await request(app).get('/api/vehicles').set('authorization', `Bearer ${token}`);
    const amb01 = vehicles.body.find((vehicle: { id: string }) => vehicle.id === 'AMB-01');
    const amb02 = vehicles.body.find((vehicle: { id: string }) => vehicle.id === 'AMB-02');
    expect(amb01.provisioning).toBe('PHYSICAL');
    expect(amb02.provisioning).toBe('SIMULATED');

    const network = await request(app).get('/api/network').set('authorization', `Bearer ${token}`);
    const byCode = Object.fromEntries(
      network.body.junctions.map((junction: { code: string; provisioning: string }) => [
        junction.code,
        junction.provisioning,
      ]),
    );
    expect(byCode.J1).toBe('PHYSICAL');
    expect(byCode.J2).toBe('PHYSICAL');
    expect(byCode.J8).toBe('SIMULATED');
  });

  it('returns 404 for an unknown endpoint', async () => {
    const response = await request(app).get('/api/nope');
    expect(response.status).toBe(404);
  });

  it('reports health without a token', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.hardwareMode).toBe('SIMULATED');
  });
});
