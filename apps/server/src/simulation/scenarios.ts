import type { SimulationStep } from '@smart-er/core';
import { RequestStatus, Severity, TrafficLevel } from '@smart-er/core';
import type { Store } from '../db/store.js';
import type { DispatchService } from '../services/dispatch.js';
import type { TimelineService } from '../services/timeline.js';
import type { SimulationEngine } from './engine.js';

export interface ScenarioContext {
  store: Store;
  dispatch: DispatchService;
  timeline: TimelineService;
  simulation: SimulationEngine;
}

export interface ScenarioRunner {
  id: string;
  name: string;
  description: string;
  expectedOutcome: string;
  steps: SimulationStep[];
  execute(step: SimulationStep, context: ScenarioContext): Promise<void>;
}

/**
 * Executes one scenario step.
 *
 * Approvals are performed here as the controller would perform them, so a
 * scenario exercises the real approval path — verification, routing, conflict
 * resolution and corridor arming — rather than a shortcut that skips it.
 */
async function executeStep(step: SimulationStep, context: ScenarioContext): Promise<void> {
  const { store, dispatch, simulation } = context;

  switch (step.action) {
    case 'SIGN_ON': {
      dispatch.signOn(step.vehicleId, step.driverId);
      return;
    }

    case 'REQUEST': {
      const state = store.vehicleState(step.vehicleId);
      const driverId = state?.driverId;
      if (!driverId) throw new Error(`${step.vehicleId} has no driver signed on`);
      dispatch.submitRequest({
        vehicleId: step.vehicleId,
        driverId,
        severity: step.severity,
        ...(step.destinationFacilityId ? { destinationFacilityId: step.destinationFacilityId } : {}),
        ...(step.destinationIncidentId ? { destinationIncidentId: step.destinationIncidentId } : {}),
        ...(step.note ? { note: step.note } : {}),
        ...(step.destinationIncidentId ? { incidentId: step.destinationIncidentId } : {}),
      });
      return;
    }

    case 'APPROVE': {
      const pending = store.repositories.requests.find(
        (request) => request.vehicleId === step.vehicleCallSign && request.status === RequestStatus.PENDING,
      )[0];
      if (!pending) throw new Error(`No pending request for ${step.vehicleCallSign}`);
      await dispatch.approveRequest(pending.id, 'USR-CTRL-01');
      return;
    }

    case 'REPORT_INCIDENT': {
      const incident = store.repositories.incidents.get(step.incidentId);
      if (incident) context.timeline.record({
        kind: 'incident.reported',
        message: `${incident.code} reported at ${incident.address}: ${incident.description}`,
        incidentId: incident.id,
        severity: incident.severity,
      });
      return;
    }

    case 'SET_TRAFFIC': {
      store.graph.setTraffic(step.roadSegmentId, step.traffic);
      context.timeline.record({
        kind: 'traffic.changed',
        message: `Traffic on ${store.graph.segment(step.roadSegmentId)?.name ?? step.roadSegmentId} is now ${step.traffic}.`,
        data: { roadSegmentId: step.roadSegmentId, traffic: step.traffic },
      });
      return;
    }

    case 'BLOCK_ROAD': {
      store.graph.setBlocked(step.roadSegmentId, step.blocked);
      context.timeline.record({
        kind: step.blocked ? 'road.blocked' : 'road.reopened',
        message: `${store.graph.segment(step.roadSegmentId)?.name ?? step.roadSegmentId} is ${step.blocked ? 'closed' : 'reopened'}.`,
        data: { roadSegmentId: step.roadSegmentId },
      });
      return;
    }

    case 'GPS_FAILURE': {
      store.hardware.gps.setFailed(step.vehicleId, step.failed);
      simulation.setManualGps(step.vehicleId, false);
      context.timeline.record({
        kind: step.failed ? 'gps.lost' : 'gps.restored',
        message: step.failed
          ? `${step.vehicleId} has lost GPS lock. Corridor is holding its last confirmed position.`
          : `${step.vehicleId} has regained GPS lock.`,
        vehicleId: step.vehicleId,
      });
      return;
    }

    case 'DEVICE_OFFLINE': {
      const device = store.repositories.devices.get(step.deviceId);
      if (device) {
        store.repositories.devices.put({
          ...device,
          status: step.offline ? 'OFFLINE' : 'ONLINE',
        });
      }
      store.hardware.status.setStatus(step.deviceId, step.offline ? 'OFFLINE' : 'ONLINE');
      const junction = store.graph.junctions.find((entry) => entry.hardwareDeviceId === step.deviceId);
      if (junction) store.hardware.signals.setJunctionOffline(junction.id, step.offline);

      context.timeline.record({
        kind: step.offline ? 'hardware.offline' : 'hardware.online',
        message: step.offline
          ? `Controller ${step.deviceId} is unreachable. Its junction is excluded from corridor planning.`
          : `Controller ${step.deviceId} is back online.`,
        ...(junction ? { junctionId: junction.id } : {}),
      });
      return;
    }
  }
}

function scenario(
  id: string,
  name: string,
  description: string,
  expectedOutcome: string,
  steps: SimulationStep[],
): ScenarioRunner {
  return { id, name, description, expectedOutcome, steps, execute: executeStep };
}

/**
 * Demonstration scenarios.
 *
 * Each one is a rehearsable script for a specific capability in the brief. They
 * are ordered from the simplest end-to-end run to the failure modes, because
 * that is the order they are worth showing in.
 */
export const SCENARIOS: ScenarioRunner[] = [
  scenario(
    'single-ambulance',
    'Single ambulance to hospital',
    'One ambulance requests a corridor to City General. Controller approves, the hospital is notified, and a rolling green corridor follows the vehicle across the network.',
    'One junction green at a time, junctions behind the ambulance released immediately, hospital ETA updating live.',
    [
      { at: 1, action: 'SIGN_ON', vehicleId: 'AMB-01', driverId: 'DRV-001' },
      {
        at: 3,
        action: 'REQUEST',
        vehicleId: 'AMB-01',
        destinationFacilityId: 'FAC-HOSP-01',
        severity: Severity.CRITICAL,
        note: 'Cardiac arrest, 62M, CPR in progress',
      },
      { at: 6, action: 'APPROVE', vehicleCallSign: 'AMB-01' },
    ],
  ),

  scenario(
    'ambulance-fire-conflict',
    'Ambulance + fire, shared junction',
    'AMB-01 runs west along MG Road to City General while FIRE-01 is dispatched east to a retail fire at Trinity Circle. The two routes cross at the same junction within one clearance window.',
    'Conflict detected at the shared junction, a conflict-free alternative computed for the lower-priority unit, and only the contended junction coordinated — the fire appliance is never simply blocked.',
    [
      { at: 1, action: 'SIGN_ON', vehicleId: 'AMB-01', driverId: 'DRV-001' },
      { at: 2, action: 'SIGN_ON', vehicleId: 'FIRE-01', driverId: 'DRV-003' },
      { at: 3, action: 'REPORT_INCIDENT', incidentId: 'INC-1004' },
      {
        at: 4,
        action: 'REQUEST',
        vehicleId: 'AMB-01',
        destinationFacilityId: 'FAC-HOSP-01',
        severity: Severity.CRITICAL,
        note: 'Cardiac arrest, 62M',
      },
      { at: 6, action: 'APPROVE', vehicleCallSign: 'AMB-01' },
      {
        at: 9,
        action: 'REQUEST',
        vehicleId: 'FIRE-01',
        destinationIncidentId: 'INC-1004',
        severity: Severity.HIGH,
        note: 'Structure fire, occupants evacuating',
      },
      { at: 11, action: 'APPROVE', vehicleCallSign: 'FIRE-01' },
    ],
  ),

  scenario(
    'multi-vehicle',
    'Four units, simultaneous',
    'Two ambulances, a fire appliance and a police unit all run at once, each with its own route, ETA, corridor and junction allocations.',
    'Four independent corridors coexisting, contention resolved per junction, and public traffic impact staying proportionate.',
    [
      { at: 1, action: 'SIGN_ON', vehicleId: 'AMB-01', driverId: 'DRV-001' },
      { at: 1, action: 'SIGN_ON', vehicleId: 'AMB-02', driverId: 'DRV-002' },
      { at: 1, action: 'SIGN_ON', vehicleId: 'FIRE-01', driverId: 'DRV-003' },
      { at: 1, action: 'SIGN_ON', vehicleId: 'POL-01', driverId: 'DRV-004' },
      { at: 3, action: 'REQUEST', vehicleId: 'AMB-01', destinationFacilityId: 'FAC-HOSP-01', severity: Severity.CRITICAL },
      { at: 5, action: 'APPROVE', vehicleCallSign: 'AMB-01' },
      { at: 7, action: 'REQUEST', vehicleId: 'FIRE-01', destinationIncidentId: 'INC-1001', severity: Severity.HIGH },
      { at: 9, action: 'APPROVE', vehicleCallSign: 'FIRE-01' },
      { at: 12, action: 'REQUEST', vehicleId: 'POL-01', destinationIncidentId: 'INC-1002', severity: Severity.MEDIUM },
      { at: 14, action: 'APPROVE', vehicleCallSign: 'POL-01' },
      { at: 17, action: 'REQUEST', vehicleId: 'AMB-02', destinationFacilityId: 'FAC-HOSP-02', severity: Severity.HIGH },
      { at: 19, action: 'APPROVE', vehicleCallSign: 'AMB-02' },
    ],
  ),

  scenario(
    'dynamic-reroute',
    'Road closure mid-run',
    'An ambulance is already running when a road on its active route closes.',
    'Automatic reroute with the reason recorded, the old corridor torn down before the new one is armed, and the crew told the new ETA.',
    [
      { at: 1, action: 'SIGN_ON', vehicleId: 'AMB-01', driverId: 'DRV-001' },
      { at: 3, action: 'REQUEST', vehicleId: 'AMB-01', destinationFacilityId: 'FAC-HOSP-01', severity: Severity.CRITICAL },
      { at: 5, action: 'APPROVE', vehicleCallSign: 'AMB-01' },
      { at: 25, action: 'BLOCK_ROAD', roadSegmentId: 'J2-J3', blocked: true },
      { at: 25, action: 'BLOCK_ROAD', roadSegmentId: 'J3-J2', blocked: true },
    ],
  ),

  scenario(
    'traffic-degradation',
    'Traffic collapses on the fast route',
    'Heavy congestion builds on the corridor the ambulance is using, making a longer route materially faster.',
    'A reroute onto the longer-but-faster option, demonstrating that SMART-ER optimises response time rather than distance.',
    [
      { at: 1, action: 'SIGN_ON', vehicleId: 'AMB-01', driverId: 'DRV-001' },
      { at: 3, action: 'REQUEST', vehicleId: 'AMB-01', destinationFacilityId: 'FAC-HOSP-02', severity: Severity.CRITICAL },
      { at: 5, action: 'APPROVE', vehicleCallSign: 'AMB-01' },
      { at: 20, action: 'SET_TRAFFIC', roadSegmentId: 'J2-J3', traffic: TrafficLevel.HEAVY },
      { at: 20, action: 'SET_TRAFFIC', roadSegmentId: 'J3-J7', traffic: TrafficLevel.HEAVY },
    ],
  ),

  scenario(
    'gps-failure',
    'GPS loss mid-corridor',
    'The on-board receiver of a running ambulance loses lock.',
    'The corridor holds the last confirmed position rather than guessing, the dashboard shows the degraded state, and normal service resumes when lock returns.',
    [
      { at: 1, action: 'SIGN_ON', vehicleId: 'AMB-01', driverId: 'DRV-001' },
      { at: 3, action: 'REQUEST', vehicleId: 'AMB-01', destinationFacilityId: 'FAC-HOSP-01', severity: Severity.CRITICAL },
      { at: 5, action: 'APPROVE', vehicleCallSign: 'AMB-01' },
      { at: 22, action: 'GPS_FAILURE', vehicleId: 'AMB-01', failed: true },
      { at: 48, action: 'GPS_FAILURE', vehicleId: 'AMB-01', failed: false },
    ],
  ),

  scenario(
    'junction-controller-offline',
    'Junction controller unreachable',
    'A junction controller on the active route stops responding to its watchdog.',
    'The junction is excluded from corridor planning and the vehicle is routed around it — a green that cannot be confirmed is never assumed.',
    [
      { at: 1, action: 'SIGN_ON', vehicleId: 'AMB-01', driverId: 'DRV-001' },
      { at: 3, action: 'REQUEST', vehicleId: 'AMB-01', destinationFacilityId: 'FAC-HOSP-01', severity: Severity.CRITICAL },
      { at: 5, action: 'APPROVE', vehicleCallSign: 'AMB-01' },
      { at: 22, action: 'DEVICE_OFFLINE', deviceId: 'HW-J3', offline: true },
      { at: 70, action: 'DEVICE_OFFLINE', deviceId: 'HW-J3', offline: false },
    ],
  ),

  scenario(
    'unauthorized-driver',
    'Unauthorised driver and lapsed operator',
    'A driver with an expired licence, on a decommissioned vehicle belonging to a lapsed operator, attempts to obtain a corridor.',
    'Sign-on is refused at the verification stage and the specific failed links in the identity chain are named.',
    [{ at: 2, action: 'SIGN_ON', vehicleId: 'AMB-09', driverId: 'DRV-009' }],
  ),
];

export function scenarioSummaries() {
  return SCENARIOS.map(({ id, name, description, expectedOutcome, steps }) => ({
    id,
    name,
    description,
    expectedOutcome,
    steps,
  }));
}
