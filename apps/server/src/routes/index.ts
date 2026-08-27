import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  Severity,
  TrafficLevel,
  computePublicImpact,
  isoNow,
  nextId,
  type Incident,
} from '@smart-er/core';
import { IncidentKind, IncidentStatus, RequestStatus, Role, RouteSource } from '@smart-er/core';
import { login } from '../auth/auth.js';
import { vehicleIdentity, verifyVehicleIdentity } from '../auth/verification.js';
import { authenticate, requireRole, requireVehicleAccess } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errors.js';
import { scenarioSummaries } from '../simulation/scenarios.js';
import type { AppContext } from '../services/context.js';

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

/**
 * Narrow an Express route parameter to a string.
 *
 * Express 5 types `req.params` values as `string | string[]`, since a route can
 * declare a repeated parameter. None of ours do, so an array or a missing value
 * is a malformed request; it becomes an empty id, which every handler below
 * already reports as "unknown".
 */
function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  return typeof value === 'string' ? value : '';
}

export function buildRouter(context: AppContext): Router {
  const router = Router();
  const { store, dispatch, routing, corridors, notifications, timeline, simulation, analytics } = context;
  const auth = authenticate(store);

  // -- health & metadata ----------------------------------------------------

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      serverTime: isoNow(),
      uptimeSeconds: Math.round(process.uptime()),
      hardwareMode: store.hardware.mode,
      junctions: store.graph.junctions.length,
      simulation: simulation.state(),
    });
  });

  // -- auth -----------------------------------------------------------------

  const credentials = z.object({ email: z.string().email(), password: z.string().min(1) });

  router.post(
    '/auth/login',
    asyncHandler(async (req, res) => {
      const { email, password } = credentials.parse(req.body);
      const result = await login(store, email, password);

      const driver = result.user.driverId ? store.driver(result.user.driverId) : undefined;
      const vehicles = driver
        ? driver.authorizedVehicleIds.map((id) => store.vehicle(id)).filter(Boolean)
        : [];

      res.json({
        token: result.token,
        expiresIn: result.expiresIn,
        user: result.user,
        driver,
        vehicles,
        facility: result.user.facilityId ? store.facility(result.user.facilityId) : undefined,
      });
    }),
  );

  router.get('/auth/me', auth, (req, res) => {
    const user = req.user!;
    const driver = user.driverId ? store.driver(user.driverId) : undefined;
    res.json({
      user,
      driver,
      vehicles: driver ? driver.authorizedVehicleIds.map((id) => store.vehicle(id)).filter(Boolean) : [],
      facility: user.facilityId ? store.facility(user.facilityId) : undefined,
    });
  });

  // -- reference data -------------------------------------------------------

  router.get('/network', auth, (_req, res) => {
    res.json({
      junctions: store.graph.junctions,
      roadSegments: store.graph.segments,
      junctionStates: corridors.states(),
    });
  });

  router.get('/facilities', auth, (req, res) => {
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const all = store.repositories.facilities.list();
    res.json(kind ? all.filter((facility) => facility.kind === kind) : all);
  });

  router.get('/vehicles', auth, (_req, res) => {
    res.json(
      store.repositories.vehicles.list().map((vehicle) => ({
        ...vehicle,
        state: store.vehicleState(vehicle.id),
        organization: store.repositories.organizations.get(vehicle.organizationId),
      })),
    );
  });

  router.get('/vehicles/:vehicleId/identity', auth, (req, res) => {
    const identity = vehicleIdentity(store, param(req, 'vehicleId'));
    if (!identity) {
      res.status(404).json({ error: `Unknown vehicle ${param(req, 'vehicleId')}` });
      return;
    }
    res.json(identity);
  });

  router.get('/vehicles/:vehicleId/verify', auth, (req, res) => {
    const driverId = typeof req.query.driverId === 'string' ? req.query.driverId : req.user?.driverId;
    if (!driverId) {
      res.status(400).json({ error: 'A driverId is required to verify a vehicle.' });
      return;
    }
    res.json(verifyVehicleIdentity(store, param(req, 'vehicleId'), driverId));
  });

  router.get('/snapshot', auth, (_req, res) => {
    res.json(context.snapshot());
  });

  // -- driver ---------------------------------------------------------------

  const signOnSchema = z.object({ vehicleId: z.string().min(1) });

  router.post(
    '/driver/sign-on',
    auth,
    requireRole(Role.DRIVER),
    requireVehicleAccess(store, (req) => (req.body as { vehicleId?: string }).vehicleId),
    asyncHandler(async (req, res) => {
      const { vehicleId } = signOnSchema.parse(req.body);
      const driverId = req.user!.driverId!;
      res.json(dispatch.signOn(vehicleId, driverId));
    }),
  );

  router.post(
    '/driver/sign-off',
    auth,
    requireRole(Role.DRIVER),
    requireVehicleAccess(store, (req) => (req.body as { vehicleId?: string }).vehicleId),
    asyncHandler(async (req, res) => {
      const { vehicleId } = signOnSchema.parse(req.body);
      res.json(dispatch.signOff(vehicleId) ?? { ok: true });
    }),
  );

  router.post(
    '/driver/standby',
    auth,
    requireRole(Role.DRIVER, Role.CONTROLLER),
    requireVehicleAccess(store, (req) => (req.body as { vehicleId?: string }).vehicleId),
    asyncHandler(async (req, res) => {
      const { vehicleId } = signOnSchema.parse(req.body);
      const state = dispatch.returnToStandby(vehicleId);
      if (!state) {
        res.status(404).json({ error: `Unknown vehicle ${vehicleId}` });
        return;
      }
      res.json(state);
    }),
  );

  // -- emergency requests ---------------------------------------------------

  const requestSchema = z
    .object({
      vehicleId: z.string().min(1),
      severity: z.enum([Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW]),
      destinationFacilityId: z.string().optional(),
      destinationIncidentId: z.string().optional(),
      destinationPoint: latLng.extend({ name: z.string().optional() }).optional(),
      note: z.string().max(400).optional(),
    })
    .refine(
      (value) =>
        Boolean(value.destinationFacilityId ?? value.destinationIncidentId ?? value.destinationPoint),
      { message: 'A destination facility, incident or map point is required.' },
    );

  router.post(
    '/requests',
    auth,
    requireVehicleAccess(store, (req) => (req.body as { vehicleId?: string }).vehicleId),
    asyncHandler(async (req, res) => {
      const body = requestSchema.parse(req.body);
      const driverId = req.user!.driverId ?? store.vehicleState(body.vehicleId)?.driverId;
      if (!driverId) {
        res.status(400).json({ error: 'No driver is signed on to this vehicle.' });
        return;
      }
      res.status(201).json(
        dispatch.submitRequest({
          vehicleId: body.vehicleId,
          driverId,
          severity: body.severity,
          ...(body.destinationFacilityId ? { destinationFacilityId: body.destinationFacilityId } : {}),
          ...(body.destinationIncidentId ? { destinationIncidentId: body.destinationIncidentId } : {}),
          ...(body.destinationPoint ? { destinationPoint: body.destinationPoint } : {}),
          ...(body.note ? { note: body.note } : {}),
          ...(body.destinationIncidentId ? { incidentId: body.destinationIncidentId } : {}),
        }),
      );
    }),
  );

  router.get('/requests', auth, (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const all = store.repositories.requests.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(status ? all.filter((request) => request.status === status) : all);
  });

  router.get('/requests/:requestId', auth, (req, res) => {
    const request = store.repositories.requests.get(param(req, 'requestId'));
    if (!request) {
      res.status(404).json({ error: 'Unknown request.' });
      return;
    }
    res.json({
      request,
      route: request.routeId ? store.repositories.routes.get(request.routeId) : undefined,
      corridor: request.corridorId ? store.repositories.corridors.get(request.corridorId) : undefined,
      identity: vehicleIdentity(store, request.vehicleId),
      timeline: timeline.forRequest(request.id),
    });
  });

  router.post(
    '/requests/:requestId/approve',
    auth,
    requireRole(Role.CONTROLLER),
    asyncHandler(async (req, res) => {
      res.json(await dispatch.approveRequest(param(req, 'requestId'), req.user!.id));
    }),
  );

  const rejectSchema = z.object({ reason: z.string().min(3).max(300) });

  router.post(
    '/requests/:requestId/reject',
    auth,
    requireRole(Role.CONTROLLER),
    asyncHandler(async (req, res) => {
      const { reason } = rejectSchema.parse(req.body);
      res.json(dispatch.rejectRequest(param(req, 'requestId'), req.user!.id, reason));
    }),
  );

  const cancelSchema = z.object({ vehicleId: z.string().min(1), reason: z.string().min(3).max(300) });

  router.post(
    '/requests/cancel',
    auth,
    asyncHandler(async (req, res) => {
      const { vehicleId, reason } = cancelSchema.parse(req.body);
      await dispatch.cancelRequest(vehicleId, reason);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/requests/:requestId/arrived',
    auth,
    requireRole(Role.HOSPITAL, Role.FIRE_STATION, Role.POLICE, Role.CONTROLLER),
    asyncHandler(async (req, res) => {
      const request = store.repositories.requests.get(param(req, 'requestId'));
      if (!request) {
        res.status(404).json({ error: 'Unknown request.' });
        return;
      }
      dispatch.confirmArrival(request.vehicleId);
      res.json({ ok: true });
    }),
  );

  // -- routes ---------------------------------------------------------------

  router.get('/routes', auth, (req, res) => {
    const activeOnly = req.query.active !== 'false';
    const all = store.repositories.routes.list();
    res.json(activeOnly ? all.filter((route) => route.active) : all);
  });

  /**
   * Adopt Google-derived geometry for a route.
   *
   * The Maps JavaScript Routes library runs in the browser, so the controller
   * dashboard computes the real road polyline and traffic-aware ETA and posts
   * them here. The simulation then drives vehicles along actual roads.
   */
  const geometrySchema = z.object({
    path: z.array(latLng).min(2),
    distanceM: z.number().positive().optional(),
    etaSeconds: z.number().positive().optional(),
    source: z.enum([RouteSource.GOOGLE_ROUTES, RouteSource.GOOGLE_DIRECTIONS]).optional(),
  });

  router.post(
    '/routes/:routeId/geometry',
    auth,
    requireRole(Role.CONTROLLER, Role.DRIVER),
    asyncHandler(async (req, res) => {
      const body = geometrySchema.parse(req.body);
      const updated = routing.applyGoogleGeometry(param(req, 'routeId'), body);
      if (!updated) {
        res.status(404).json({ error: 'Unknown route, or the supplied geometry was not usable.' });
        return;
      }
      context.bus.emit('route.updated', updated);
      res.json(updated);
    }),
  );

  const rerouteSchema = z.object({ vehicleId: z.string().min(1), reason: z.string().max(300).optional() });

  router.post(
    '/routes/reroute',
    auth,
    requireRole(Role.CONTROLLER),
    asyncHandler(async (req, res) => {
      const { vehicleId, reason } = rerouteSchema.parse(req.body);
      const route = await dispatch.rerouteVehicle(
        vehicleId,
        'REROUTED_TRAFFIC',
        reason ?? 'Manual reroute requested by the controller.',
      );
      if (!route) {
        res.status(409).json({ error: 'No alternative route is available for this vehicle.' });
        return;
      }
      res.json(route);
    }),
  );

  // -- corridors, conflicts, junctions --------------------------------------

  router.get('/corridors', auth, (_req, res) => {
    res.json(store.repositories.corridors.list());
  });

  router.get('/conflicts', auth, (_req, res) => {
    res.json(store.repositories.conflicts.list().sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)));
  });

  router.get('/junctions/:junctionId', auth, (req, res) => {
    const junction = store.junction(param(req, 'junctionId'));
    if (!junction) {
      res.status(404).json({ error: 'Unknown junction.' });
      return;
    }
    const controller = store.hardware.signals.get(junction.id);
    res.json({
      junction,
      state: corridors.state(junction.id),
      device: store.device(junction.hardwareDeviceId),
      aspects: controller ? Object.fromEntries(controller.aspects()) : {},
      allocations: store
        .activeCorridors()
        .flatMap((corridor) => corridor.allocations)
        .filter((allocation) => allocation.junctionId === junction.id),
      recentCommands: store.repositories.commands
        .find((command) => command.junctionId === junction.id)
        .slice(-15),
    });
  });

  router.get('/impact', auth, (_req, res) => {
    res.json(computePublicImpact({ junctions: store.graph.junctions, corridors: store.activeCorridors() }));
  });

  // -- incidents ------------------------------------------------------------

  const incidentSchema = z.object({
    kind: z.enum([
      IncidentKind.MEDICAL,
      IncidentKind.FIRE,
      IncidentKind.LAW_ENFORCEMENT,
      IncidentKind.ROAD_ACCIDENT,
    ]),
    severity: z.enum([Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW]),
    position: latLng,
    address: z.string().min(3).max(200),
    description: z.string().min(3).max(500),
    ownerFacilityId: z.string().optional(),
  });

  router.get('/incidents', auth, (_req, res) => {
    res.json(store.repositories.incidents.list().sort((a, b) => b.reportedAt.localeCompare(a.reportedAt)));
  });

  router.post(
    '/incidents',
    auth,
    requireRole(Role.FIRE_STATION, Role.POLICE, Role.CONTROLLER, Role.HOSPITAL),
    asyncHandler(async (req, res) => {
      const body = incidentSchema.parse(req.body);
      const prefix =
        body.kind === IncidentKind.FIRE ? 'FIRE' : body.kind === IncidentKind.LAW_ENFORCEMENT ? 'POL' : 'INC';
      const incident: Incident = {
        id: nextId('INC'),
        code: nextId(prefix),
        kind: body.kind,
        severity: body.severity,
        status: IncidentStatus.REPORTED,
        position: body.position,
        address: body.address,
        description: body.description,
        reportedAt: isoNow(),
        reportedByUserId: req.user!.id,
        ...(body.ownerFacilityId ?? req.user!.facilityId
          ? { ownerFacilityId: body.ownerFacilityId ?? req.user!.facilityId }
          : {}),
        assignedVehicleIds: [],
      };
      store.repositories.incidents.put(incident);
      context.bus.emit('incident.created', incident);
      timeline.record({
        kind: 'incident.reported',
        message: `${incident.code} reported at ${incident.address}: ${incident.description}`,
        incidentId: incident.id,
        severity: incident.severity,
      });
      notifications.send({
        audience: { role: Role.CONTROLLER },
        title: `${incident.code} — ${incident.severity}`,
        body: `${incident.description} (${incident.address})`,
        severity: incident.severity,
        incidentId: incident.id,
      });
      res.status(201).json(incident);
    }),
  );

  /**
   * Assign a unit to an incident.
   *
   * This is how a fire station or police HQ dispatches: it signs the driver on
   * if needed, raises the emergency request on the unit's behalf, and leaves it
   * pending for the controller — the same path a driver-initiated request takes.
   */
  const assignSchema = z.object({
    vehicleId: z.string().min(1),
    driverId: z.string().optional(),
    severity: z.enum([Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW]).optional(),
    note: z.string().max(400).optional(),
  });

  router.post(
    '/incidents/:incidentId/assign',
    auth,
    requireRole(Role.FIRE_STATION, Role.POLICE, Role.CONTROLLER),
    asyncHandler(async (req, res) => {
      const incident = store.repositories.incidents.get(param(req, 'incidentId'));
      if (!incident) {
        res.status(404).json({ error: 'Unknown incident.' });
        return;
      }
      const body = assignSchema.parse(req.body);

      const state = store.vehicleState(body.vehicleId);
      const driverId =
        body.driverId ??
        state?.driverId ??
        store.repositories.drivers.find((driver) => driver.authorizedVehicleIds.includes(body.vehicleId))[0]?.id;
      if (!driverId) {
        res.status(400).json({ error: `No driver is available for ${body.vehicleId}.` });
        return;
      }
      if (!state?.driverId) dispatch.signOn(body.vehicleId, driverId);

      const request = dispatch.submitRequest({
        vehicleId: body.vehicleId,
        driverId,
        severity: body.severity ?? incident.severity,
        destinationIncidentId: incident.id,
        incidentId: incident.id,
        ...(body.note ? { note: body.note } : {}),
      });

      const updated = {
        ...incident,
        status: IncidentStatus.DISPATCHED,
        assignedVehicleIds: [...new Set([...incident.assignedVehicleIds, body.vehicleId])],
      };
      store.repositories.incidents.put(updated);
      context.bus.emit('incident.updated', updated);

      res.status(201).json({ incident: updated, request });
    }),
  );

  router.post(
    '/incidents/:incidentId/resolve',
    auth,
    requireRole(Role.FIRE_STATION, Role.POLICE, Role.CONTROLLER),
    asyncHandler(async (req, res) => {
      const incident = store.repositories.incidents.get(param(req, 'incidentId'));
      if (!incident) {
        res.status(404).json({ error: 'Unknown incident.' });
        return;
      }
      const updated = { ...incident, status: IncidentStatus.RESOLVED, resolvedAt: isoNow() };
      store.repositories.incidents.put(updated);
      context.bus.emit('incident.updated', updated);
      timeline.record({
        kind: 'incident.resolved',
        message: `${incident.code} resolved.`,
        incidentId: incident.id,
      });
      res.json(updated);
    }),
  );

  // -- notifications & timeline ---------------------------------------------

  router.get('/notifications', auth, (req, res) => {
    const user = req.user!;
    res.json(
      notifications.for({
        userId: user.id,
        role: user.role,
        ...(user.facilityId ? { facilityId: user.facilityId } : {}),
      }),
    );
  });

  router.post('/notifications/:notificationId/read', auth, (req, res) => {
    const updated = notifications.markRead(param(req, 'notificationId'));
    if (!updated) {
      res.status(404).json({ error: 'Unknown notification.' });
      return;
    }
    res.json(updated);
  });

  router.get('/timeline', auth, (req, res) => {
    const { requestId, vehicleId } = req.query;
    if (typeof requestId === 'string') {
      res.json(timeline.forRequest(requestId));
      return;
    }
    if (typeof vehicleId === 'string') {
      res.json(timeline.forVehicle(vehicleId));
      return;
    }
    res.json(timeline.recent(200));
  });

  // -- analytics, health and alerts ------------------------------------------

  /**
   * Everything the dashboard's summary cards and side panels need, in one
   * round trip. Kept together because they are always rendered together and
   * four separate requests on every dashboard load is wasteful.
   *
   * `maps` reports whether the *browser* has a Maps key — the server cannot
   * see it, so the client states it and the server reflects it back into the
   * status list rather than guessing.
   */
  router.get('/dashboard', auth, (req, res) => {
    const mapsConfigured = req.query.maps === 'true';
    res.json({
      headline: analytics.headline(),
      systemStatus: analytics.systemStatus(mapsConfigured),
      responseHistory: analytics.responseHistory(
        Math.max(1, Math.min(30, Number.parseInt(String(req.query.days ?? '7'), 10) || 7)),
      ),
      impact: computePublicImpact({ junctions: store.graph.junctions, corridors: store.activeCorridors() }),
    });
  });

  router.get('/analytics/response', auth, (req, res) => {
    const days = Math.max(1, Math.min(30, Number.parseInt(String(req.query.days ?? '7'), 10) || 7));
    res.json({
      days,
      samples: analytics.responseHistory(days),
      averageImprovementPercent: analytics.averageImprovementPercent(days),
    });
  });

  router.get('/system-status', auth, (req, res) => {
    res.json(analytics.systemStatus(req.query.maps === 'true'));
  });

  /**
   * Recent operational alerts.
   *
   * Derived from the incident timeline rather than stored separately: an alert
   * is a timeline event a controller would want pulled out of the stream, so
   * filtering the real record keeps the two from ever disagreeing.
   */
  router.get('/alerts', auth, (req, res) => {
    const limit = Math.max(1, Math.min(100, Number.parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const notable = new Set([
      'conflict.detected',
      'conflict.reroute',
      'conflict.time_slot',
      'conflict.priority_hold',
      'route.rerouted',
      'corridor.activated',
      'corridor.released',
      'junction.green',
      'safety.rejected',
      'signal.nack',
      'signal.abandoned',
      'gps.lost',
      'gps.restored',
      'hardware.offline',
      'hardware.online',
      'road.blocked',
      'road.reopened',
      'traffic.changed',
      'incident.reported',
      'request.rejected',
    ]);

    const severityOf = (kind: string): 'critical' | 'warning' | 'info' => {
      if (kind.startsWith('conflict.') || kind.startsWith('safety.') || kind === 'signal.abandoned') return 'critical';
      if (kind.startsWith('gps.') || kind.startsWith('hardware.') || kind.startsWith('road.') || kind === 'signal.nack') {
        return 'warning';
      }
      return 'info';
    };

    const alerts = timeline
      .recent(400)
      .filter((event) => notable.has(event.kind))
      .slice(-limit)
      .reverse()
      .map((event) => ({
        id: event.id,
        at: event.at,
        kind: event.kind,
        severity: severityOf(event.kind),
        message: event.message,
        vehicleId: event.vehicleId,
        junctionId: event.junctionId,
      }));

    res.json(alerts);
  });

  // -- hardware -------------------------------------------------------------

  router.get('/hardware', auth, (_req, res) => {
    res.json({
      mode: store.hardware.mode,
      devices: store.repositories.devices.list(),
      junctionStates: corridors.states(),
      watchdogTimeoutMs: store.hardware.watchdog.timeoutMs,
    });
  });

  // -- simulation -----------------------------------------------------------

  router.get('/simulation', auth, (_req, res) => {
    res.json({ state: simulation.state(), scenarios: scenarioSummaries() });
  });

  const scenarioSchema = z.object({ scenarioId: z.string().min(1) });

  router.post(
    '/simulation/scenario',
    auth,
    requireRole(Role.CONTROLLER),
    asyncHandler(async (req, res) => {
      const { scenarioId } = scenarioSchema.parse(req.body);
      res.json(await simulation.startScenario(scenarioId));
    }),
  );

  router.post(
    '/simulation/stop',
    auth,
    requireRole(Role.CONTROLLER),
    asyncHandler(async (_req, res) => {
      res.json(await simulation.stopScenario());
    }),
  );

  const speedSchema = z.object({ speed: z.number().min(0.25).max(10) });

  router.post(
    '/simulation/speed',
    auth,
    requireRole(Role.CONTROLLER),
    asyncHandler(async (req, res) => {
      simulation.setSpeed(speedSchema.parse(req.body).speed);
      res.json(simulation.state());
    }),
  );

  router.post(
    '/simulation/reset',
    auth,
    requireRole(Role.CONTROLLER),
    asyncHandler(async (_req, res) => {
      await simulation.stopScenario();
      for (const corridor of store.activeCorridors()) {
        await corridors.release(corridor, 'Simulation reset — all corridors released.');
      }
      for (const request of store.repositories.requests.find(
        (entry) => entry.status === RequestStatus.PENDING || entry.status === RequestStatus.APPROVED,
      )) {
        await dispatch.cancelRequest(request.vehicleId, 'Simulation reset.');
      }
      for (const segment of store.graph.segments) {
        store.graph.setBlocked(segment.id, false);
        store.graph.setTraffic(segment.id, TrafficLevel.NORMAL);
      }

      // Bring every junction controller back online, in case a fault was
      // injected during the previous run.
      for (const junction of store.graph.junctions) {
        store.hardware.signals.setJunctionOffline(junction.id, false);
        store.hardware.status.setStatus(junction.hardwareDeviceId, 'ONLINE');
        const device = store.device(junction.hardwareDeviceId);
        if (device) store.repositories.devices.put({ ...device, status: 'ONLINE' });
      }
      corridors.syncDeviceStatus();

      // And park every unit back at its standby post.
      dispatch.resetFleet();

      context.bus.emit('traffic.updated', store.graph.segments);
      context.bus.emit('hardware.updated', store.repositories.devices.list());
      res.json(simulation.state());
    }),
  );

  // -- simulator controls for hardware fault injection ----------------------

  const faultSchema = z.object({
    kind: z.enum(['gps', 'junction', 'traffic', 'road']),
    targetId: z.string().min(1),
    enabled: z.boolean().optional(),
    traffic: z
      .enum([
        TrafficLevel.FREE_FLOW,
        TrafficLevel.NORMAL,
        TrafficLevel.SLOW,
        TrafficLevel.HEAVY,
        TrafficLevel.BLOCKED,
      ])
      .optional(),
  });

  router.post(
    '/simulation/fault',
    auth,
    requireRole(Role.CONTROLLER),
    asyncHandler(async (req, res) => {
      const body = faultSchema.parse(req.body);
      const enabled = body.enabled ?? true;

      switch (body.kind) {
        case 'gps':
          store.hardware.gps.setFailed(body.targetId, enabled);
          break;
        case 'junction': {
          const junction = store.junction(body.targetId);
          if (!junction) {
            res.status(404).json({ error: 'Unknown junction.' });
            return;
          }
          store.hardware.signals.setJunctionOffline(junction.id, enabled);
          store.hardware.status.setStatus(junction.hardwareDeviceId, enabled ? 'OFFLINE' : 'ONLINE');
          const device = store.device(junction.hardwareDeviceId);
          if (device) {
            store.repositories.devices.put({ ...device, status: enabled ? 'OFFLINE' : 'ONLINE' });
          }
          corridors.syncDeviceStatus();
          break;
        }
        case 'traffic':
          store.graph.setTraffic(body.targetId, body.traffic ?? TrafficLevel.HEAVY);
          context.bus.emit('traffic.updated', store.graph.segments);
          break;
        case 'road':
          store.graph.setBlocked(body.targetId, enabled);
          context.bus.emit('traffic.updated', store.graph.segments);
          break;
      }

      context.bus.emit('hardware.updated', store.repositories.devices.list());
      res.json({ ok: true });
    }),
  );

  return router;
}
