import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Vehicle } from '@smart-er/core';
import { formatClock, formatDistance, formatEta } from '@smart-er/core';
import { api, type JunctionDetail, type VehicleIdentity } from '@/api/client';
import { Badge, Button, Field, Spinner } from '@/components/ui/primitives';
import {
  CONFLICT_STATUS_STYLE,
  DEVICE_STATUS_STYLE,
  JUNCTION_STATE_STYLE,
  SEVERITY_STYLE,
  TRAFFIC_STYLE,
  VEHICLE_KIND_LABEL,
  VEHICLE_STATUS_STYLE,
} from '@/lib/status';
import { useOpsStore } from '@/stores/opsStore';
import { RouteComparison } from './RouteComparison';

/**
 * Contextual detail for whatever the operator has selected — on the map or in
 * a list. One panel rather than five, because the operator is only ever asking
 * one question ("what is this thing doing?") and a console with five detail
 * pane variants is a console where the answer is somewhere else.
 */
export function DetailPanel({ vehicleById }: { vehicleById: Map<string, Vehicle> }) {
  const selection = useOpsStore((state) => state.selection);
  const select = useOpsStore((state) => state.select);

  if (!selection) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-6 text-center">
        <p className="max-w-[34ch] text-[11px] leading-relaxed text-ink-9000">
          Select a unit, junction, route or conflict — on the map or in any list — to inspect it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
          {selection.kind}
        </span>
        <button
          type="button"
          onClick={() => select(undefined)}
          aria-label="Close detail"
          className="text-ink-9000 transition-colors hover:text-ink-700"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selection.kind === 'vehicle' && <VehicleDetail vehicleId={selection.id} vehicleById={vehicleById} />}
        {selection.kind === 'junction' && <JunctionDetailView junctionId={selection.id} />}
        {selection.kind === 'route' && <RouteDetail routeId={selection.id} />}
        {selection.kind === 'conflict' && <ConflictDetail conflictId={selection.id} />}
        {selection.kind === 'incident' && <IncidentDetail incidentId={selection.id} />}
        {selection.kind === 'facility' && <FacilityDetail facilityId={selection.id} />}
      </div>
    </div>
  );
}

function VehicleDetail({ vehicleId, vehicleById }: { vehicleId: string; vehicleById: Map<string, Vehicle> }) {
  const state = useOpsStore((store) => store.vehicles[vehicleId]);
  const requests = useOpsStore((store) => store.requests);
  const routes = useOpsStore((store) => store.routes);
  const corridors = useOpsStore((store) => store.corridors);
  const junctions = useOpsStore((store) => store.junctions);
  const [identity, setIdentity] = useState<VehicleIdentity | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setIdentity(undefined);
    void api
      .vehicleIdentity(vehicleId)
      .then(setIdentity)
      .catch(() => undefined);
  }, [vehicleId]);

  const vehicle = vehicleById.get(vehicleId);
  if (!state || !vehicle) return <Spinner />;

  const request = state.activeRequestId ? requests[state.activeRequestId] : undefined;
  const route = state.activeRouteId ? routes[state.activeRouteId] : undefined;
  const corridor = state.corridorId ? corridors[state.corridorId] : undefined;
  const style = VEHICLE_STATUS_STYLE[state.status];
  const codeOf = (id: string) => junctions.find((junction) => junction.id === id)?.code ?? id;

  const reroute = async () => {
    setBusy(true);
    try {
      await api.reroute(vehicleId, 'Manual reroute requested by the controller.');
    } catch {
      // The timeline records the outcome either way.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="divide-y divide-line">
      <section className="px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="tnum font-mono text-sm font-semibold text-ink-900">{vehicle.callSign}</h3>
          <Badge className={style.chip}>{style.label}</Badge>
        </div>
        <p className="text-[11px] text-ink-500">
          {VEHICLE_KIND_LABEL[vehicle.kind]} · {vehicle.registrationNumber}
        </p>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Speed" value={`${Math.round(state.speedKph)} km/h`} mono />
          <Field label="Heading" value={`${Math.round(state.heading)}°`} mono />
          <Field label="ETA" value={formatEta(state.etaSeconds)} mono />
          <Field label="Remaining" value={formatDistance(state.distanceRemainingM)} mono />
          <Field
            label="GPS"
            value={
              <span className={state.gpsOk ? 'text-ok-600' : 'text-violet-500'}>
                {state.gpsOk ? `Locked ±${Math.round(state.gpsAccuracy)} m` : 'No lock'}
              </span>
            }
          />
          <Field label="Next junction" value={state.nextJunctionId ? codeOf(state.nextJunctionId) : '—'} mono />
        </div>
      </section>

      {/* Identity chain — what the controller verifies before granting a corridor. */}
      <section className="px-2.5 py-2">
        <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">Identity chain</h4>
        {identity ? (
          <div className="space-y-1">
            <ChainLink label="Driver" value={identity.authorizedDrivers.map((driver) => `${driver.id} ${driver.name}`).join(', ') || '—'} />
            <ChainLink label="Vehicle" value={`${identity.vehicle.callSign} · ${identity.vehicle.registrationNumber}`} />
            <ChainLink
              label="Operator"
              value={identity.organization ? `${identity.organization.name} · ${identity.organization.licenceNumber}` : '—'}
              warn={identity.organization ? !identity.organization.active : true}
            />
            <ChainLink
              label="Telemetry unit"
              value={identity.device ? `${identity.device.serial} · ${identity.device.firmwareVersion}` : '—'}
              warn={identity.device?.status === 'OFFLINE'}
            />
            <ChainLink label="Base" value={identity.baseFacility?.name ?? '—'} />
          </div>
        ) : (
          <Spinner />
        )}
      </section>

      {request && (
        <section className="px-2.5 py-2">
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">Active request</h4>
          <div className="flex items-center gap-1.5">
            <span className="tnum font-mono text-[11px] text-ink-800">{request.id}</span>
            <Badge className={SEVERITY_STYLE[request.severity].chip}>{SEVERITY_STYLE[request.severity].label}</Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-ink-600">{request.destination.name}</p>
          {request.note && <p className="mt-0.5 text-[11px] italic text-ink-500">{request.note}</p>}
        </section>
      )}

      {corridor && (
        <section className="px-2.5 py-2">
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Rolling corridor
          </h4>
          <ol className="space-y-0.5">
            {corridor.allocations.map((allocation) => {
              const allocationStyle = JUNCTION_STATE_STYLE[allocation.state];
              return (
                <li key={allocation.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: allocationStyle.hex }} aria-hidden />
                    <span className="tnum font-mono text-[11px] text-ink-700">{codeOf(allocation.junctionId)}</span>
                    {allocation.timeSlotted && (
                      <span className="text-[9px] uppercase tracking-wider text-info-600">slotted</span>
                    )}
                  </span>
                  <span className="text-[10px]" style={{ color: allocationStyle.hex }}>
                    {allocationStyle.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {route && (
        <section className="px-2.5 py-2">
          <RouteComparison route={route} />
          <Button size="sm" className="mt-2 w-full" disabled={busy} onClick={() => void reroute()}>
            Recalculate route
          </Button>
        </section>
      )}
    </div>
  );
}

function ChainLink({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-24 shrink-0 text-[10px] uppercase tracking-wider text-ink-9000">{label}</span>
      <span className={`min-w-0 flex-1 truncate text-[11px] ${warn ? 'text-critical-600' : 'text-ink-700'}`}>
        {value}
      </span>
    </div>
  );
}

function JunctionDetailView({ junctionId }: { junctionId: string }) {
  const [detail, setDetail] = useState<JunctionDetail | undefined>();
  const runtime = useOpsStore((store) => store.junctionStates[junctionId]);

  useEffect(() => {
    setDetail(undefined);
    void api
      .junction(junctionId)
      .then(setDetail)
      .catch(() => undefined);
    // Re-fetch when the junction's live state changes, so aspects stay current.
  }, [junctionId, runtime?.state, runtime?.aspect]);

  if (!detail) return <Spinner />;

  const state = runtime?.state ?? detail.state?.state ?? 'NORMAL';
  const style = JUNCTION_STATE_STYLE[state];

  return (
    <div className="divide-y divide-line">
      <section className="px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="tnum font-mono text-sm font-semibold text-ink-900">{detail.junction.code}</h3>
          <Badge className={style.chip}>{style.label}</Badge>
        </div>
        <p className="text-[11px] text-ink-500">{detail.junction.name}</p>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Controller" value={detail.junction.hardwareDeviceId} mono />
          <Field
            label="Device"
            value={
              detail.device ? (
                <span style={{ color: DEVICE_STATUS_STYLE[detail.device.status].hex }}>
                  {DEVICE_STATUS_STYLE[detail.device.status].label}
                </span>
              ) : (
                '—'
              )
            }
          />
          <Field label="Clearance" value={`${detail.junction.clearanceSeconds} s`} mono />
          <Field label="Throughput" value={`${detail.junction.averageThroughputVph} veh/h`} mono />
          {runtime?.lastLatencyMs !== undefined && <Field label="Ack latency" value={`${runtime.lastLatencyMs} ms`} mono />}
          {runtime?.heldForVehicleId && <Field label="Held for" value={runtime.heldForVehicleId} mono />}
        </div>
      </section>

      <section className="px-2.5 py-2">
        <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">Signal aspects</h4>
        <div className="grid grid-cols-2 gap-1">
          {detail.junction.approaches.map((approach) => {
            const aspect = detail.aspects[approach.id] ?? 'RED';
            const colors: Record<string, string> = {
              GREEN: '#30a46c',
              AMBER: '#f5a524',
              RED: '#e5484d',
              ALL_RED: '#8b2c30',
              FLASHING_RED: '#8b5cf6',
            };
            return (
              <div key={approach.id} className="flex items-center gap-1.5 rounded-lg bg-surface-muted px-1.5 py-1">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colors[aspect] ?? '#4d6076' }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[10px] text-ink-600">{approach.name}</span>
                <span className="tnum font-mono text-[9px] text-ink-500">{aspect}</span>
              </div>
            );
          })}
        </div>
      </section>

      {detail.recentCommands.length > 0 && (
        <section className="px-2.5 py-2">
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Recent commands
          </h4>
          <ul className="space-y-1">
            {[...detail.recentCommands].reverse().slice(0, 8).map((command) => (
              <li key={command.id} className="text-[10px]">
                <div className="flex items-center gap-1.5">
                  <span className={command.safetyApproved ? 'text-ok-600' : 'text-critical-600'}>
                    {command.safetyApproved ? '✓' : '✕'}
                  </span>
                  <span className="tnum font-mono text-ink-600">{command.aspect}</span>
                  <time className="tnum font-mono text-ink-9000">{formatClock(command.issuedAt)}</time>
                </div>
                {!command.safetyApproved && command.safetyNotes[0] && (
                  <p className="pl-4 leading-relaxed text-critical-600">{command.safetyNotes[0]}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RouteDetail({ routeId }: { routeId: string }) {
  const route = useOpsStore((store) => store.routes[routeId]);
  if (!route) return <Spinner />;
  return (
    <div className="px-2.5 py-2">
      <RouteComparison route={route} />
    </div>
  );
}

function ConflictDetail({ conflictId }: { conflictId: string }) {
  const conflict = useOpsStore((store) => store.conflicts[conflictId]);
  if (!conflict) return <Spinner />;

  const style = CONFLICT_STATUS_STYLE[conflict.status];

  return (
    <div className="space-y-2 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="tnum font-mono text-sm font-semibold text-ink-900">{conflict.junctionId}</h3>
        <Badge className={style.chip}>{style.label}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="First" value={`${conflict.primaryVehicleId} · ${formatClock(conflict.primaryEta)}`} mono />
        <Field label="Second" value={`${conflict.secondaryVehicleId} · ${formatClock(conflict.secondaryEta)}`} mono />
        <Field label="Headway" value={`${conflict.headwaySeconds} s`} mono />
        {conflict.timeSavedSeconds !== undefined && (
          <Field label="Time saved" value={`${conflict.timeSavedSeconds} s`} mono />
        )}
      </div>

      <div className="rounded-lg border border-line bg-surface-muted px-2 py-1.5">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">Decision</p>
        <p className="text-[11px] leading-relaxed text-ink-700">{conflict.explanation}</p>
      </div>

      {conflict.originalEtaSeconds !== undefined && conflict.newEtaSeconds !== undefined && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="tnum font-mono text-ink-500">{formatEta(conflict.originalEtaSeconds)}</span>
          <span className="text-ink-300">→</span>
          <span className="tnum font-mono font-semibold text-ink-900">{formatEta(conflict.newEtaSeconds)}</span>
        </div>
      )}
    </div>
  );
}

function IncidentDetail({ incidentId }: { incidentId: string }) {
  const incident = useOpsStore((store) => store.incidents[incidentId]);
  if (!incident) return <Spinner />;

  return (
    <div className="space-y-2 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="tnum font-mono text-sm font-semibold text-ink-900">{incident.code}</h3>
        <Badge className={SEVERITY_STYLE[incident.severity].chip}>{SEVERITY_STYLE[incident.severity].label}</Badge>
      </div>
      <p className="text-[11px] text-ink-600">{incident.address}</p>
      <p className="text-[11px] leading-relaxed text-ink-500">{incident.description}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Status" value={incident.status} />
        <Field label="Reported" value={formatClock(incident.reportedAt)} mono />
      </div>
      {incident.assignedVehicleIds.length > 0 && (
        <Field label="Assigned" value={incident.assignedVehicleIds.join(', ')} mono />
      )}
    </div>
  );
}

function FacilityDetail({ facilityId }: { facilityId: string }) {
  const facility = useOpsStore((store) => store.facilities.find((entry) => entry.id === facilityId));
  const segments = useOpsStore((store) => store.roadSegments);
  if (!facility) return <Spinner />;

  // Nearest road, purely as orientation for the controller.
  const nearby = segments[0];

  return (
    <div className="space-y-2 px-2.5 py-2">
      <h3 className="text-sm font-semibold text-ink-900">{facility.name}</h3>
      <p className="text-[11px] text-ink-500">{facility.address}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Type" value={facility.kind.replace('_', ' ')} />
        <Field label="Contact" value={facility.contactNumber} mono />
        {facility.capacity !== undefined && <Field label="Capacity" value={String(facility.capacity)} mono />}
      </div>
      {facility.specialities && facility.specialities.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-ink-500">Specialities</p>
          <div className="flex flex-wrap gap-1">
            {facility.specialities.map((speciality) => (
              <Badge key={speciality} className="border-line bg-surface-sunken text-ink-700">
                {speciality}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {nearby && (
        <p className="text-[10px] text-ink-9000">
          Nearest modelled road: {nearby.name} ({TRAFFIC_STYLE[nearby.traffic].label.toLowerCase()})
        </p>
      )}
    </div>
  );
}
