import { useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, Plus, Send, Truck } from 'lucide-react';
import type { Incident, Severity as SeverityType, Vehicle, VehicleKind } from '@smart-er/core';
import {
  IncidentKind,
  IncidentStatus,
  RequestStatus,
  Severity,
  VehicleStatus,
  formatClock,
  formatEta,
} from '@smart-er/core';
import { api } from '@/api/client';
import { Badge, Button, Empty, Field, Panel } from '@/components/ui/primitives';
import { IncidentTimeline } from '@/components/panels/IncidentTimeline';
import { TopBar } from '@/components/shell/TopBar';
import { useRealtime } from '@/hooks/useRealtime';
import { useVehicleIndex } from '@/hooks/useVehicleIndex';
import { SEVERITY_STYLE, VEHICLE_STATUS_STYLE } from '@/lib/status';
import { OperationsMap } from '@/maps/OperationsMap';
import { useAuthStore } from '@/stores/authStore';
import { useOpsStore } from '@/stores/opsStore';

/**
 * Shared dispatch console for fire stations and police headquarters.
 *
 * Both services do the same three things: take a report, assign a unit, and
 * watch it run. Building one console with the service's vocabulary passed in
 * keeps their behaviour identical where it should be — assignment goes through
 * the same request-and-approval path a driver-initiated call takes, so the
 * controller still verifies the unit and still resolves conflicts.
 */
export interface DispatchConsoleProps {
  title: string;
  /** Vehicle type this service dispatches. */
  vehicleKind: VehicleKind;
  /** Incident type new reports default to. */
  incidentKind: IncidentKind;
  unitNoun: string;
}

export function DispatchConsole({ title, vehicleKind, incidentKind, unitNoun }: DispatchConsoleProps) {
  useRealtime();
  const { vehicleById, vehicles: register } = useVehicleIndex();
  const facility = useAuthStore((state) => state.facility);

  const incidentsMap = useOpsStore((state) => state.incidents);
  const vehiclesState = useOpsStore((state) => state.vehicles);
  const requests = useOpsStore((state) => state.requests);
  const select = useOpsStore((state) => state.select);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [showForm, setShowForm] = useState(false);

  const units = useMemo(
    () =>
      register
        .filter((vehicle) => vehicle.kind === vehicleKind)
        .map((vehicle) => ({ vehicle: vehicle as Vehicle, state: vehiclesState[vehicle.id] })),
    [register, vehicleKind, vehiclesState],
  );

  const incidents = useMemo(
    () =>
      Object.values(incidentsMap)
        .filter((incident) => incident.kind === incidentKind || incident.ownerFacilityId === facility?.id)
        .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt)),
    [incidentsMap, incidentKind, facility],
  );

  const open = incidents.filter((incident) => incident.status !== IncidentStatus.RESOLVED);

  const guard = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const assign = (incidentId: string, vehicleId: string) =>
    guard(() => api.assignIncident(incidentId, { vehicleId }));

  const resolve = (incidentId: string) => guard(() => api.resolveIncident(incidentId));

  return (
    <div className="flex h-full flex-col bg-canvas">
      <TopBar subtitle={facility?.name ?? title}>
        <div className="hidden items-center gap-3 lg:flex">
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-ink-9000">Open</span>
            <span className="tnum font-mono text-xs font-semibold text-warn-600">{open.length}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-ink-9000">{unitNoun}s</span>
            <span className="tnum font-mono text-xs font-semibold text-ink-800">{units.length}</span>
          </span>
        </div>
      </TopBar>

      {error && (
        <p role="alert" className="border-b border-critical-200 bg-critical-50 px-3 py-1.5 text-[11px] text-critical-600">
          {error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-1.5 p-1.5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="grid min-h-0 grid-rows-[minmax(0,1.4fr)_minmax(0,1fr)] gap-1.5">
          <Panel
            title="Incidents"
            actions={
              <Button size="sm" variant="primary" onClick={() => setShowForm((current) => !current)}>
                <Plus className="size-3" />
                Report
              </Button>
            }
          >
            {showForm && (
              <IncidentForm
                incidentKind={incidentKind}
                busy={busy}
                onCancel={() => setShowForm(false)}
                onSubmit={async (body) => {
                  await guard(() => api.createIncident(body));
                  setShowForm(false);
                }}
              />
            )}

            {open.length === 0 && !showForm ? (
              <Empty
                icon={<CheckCircle2 className="size-5" />}
                message="No open incidents"
                hint={`Report an incident to dispatch a ${unitNoun.toLowerCase()}.`}
              />
            ) : (
              <div>
                {open.map((incident) => (
                  <IncidentRow
                    key={incident.id}
                    incident={incident}
                    units={units}
                    unitNoun={unitNoun}
                    busy={busy}
                    onSelect={() => select({ kind: 'incident', id: incident.id })}
                    onAssign={(vehicleId) => void assign(incident.id, vehicleId)}
                    onResolve={() => void resolve(incident.id)}
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel title={`${unitNoun} status`}>
            {units.length === 0 ? (
              <Empty message={`No ${unitNoun.toLowerCase()}s registered`} />
            ) : (
              <div>
                {units.map(({ vehicle, state }) => {
                  const style = state ? VEHICLE_STATUS_STYLE[state.status] : VEHICLE_STATUS_STYLE.OFFLINE;
                  const request = state?.activeRequestId ? requests[state.activeRequestId] : undefined;
                  return (
                    <button
                      key={vehicle.id}
                      type="button"
                      onClick={() => select({ kind: 'vehicle', id: vehicle.id })}
                      className="row-button px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <Truck className="size-3.5 text-ink-500" />
                          <span className="tnum font-mono text-xs font-semibold text-ink-900">
                            {vehicle.callSign}
                          </span>
                        </span>
                        <div className="flex items-center gap-1.5">
                          {state?.etaSeconds !== undefined && state.status === VehicleStatus.ACTIVE && (
                            <span className="tnum font-mono text-[11px] text-ink-700">
                              {formatEta(state.etaSeconds)}
                            </span>
                          )}
                          <Badge className={style.chip}>{style.label}</Badge>
                        </div>
                      </div>
                      {request && (
                        <p className="mt-0.5 truncate pl-5 text-[11px] text-ink-500">
                          {request.destination.name}
                          {request.status === RequestStatus.PENDING && ' · awaiting controller approval'}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <div className="grid min-h-0 grid-rows-[minmax(0,1.3fr)_minmax(0,1fr)] gap-1.5">
          <Panel title="Live tracking" bodyClassName="relative overflow-hidden" className="min-h-[260px]">
            <OperationsMap vehicleById={vehicleById} className="absolute inset-0" />
          </Panel>
          <Panel title="Event timeline">
            <IncidentTimeline />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function IncidentRow({
  incident,
  units,
  unitNoun,
  busy,
  onSelect,
  onAssign,
  onResolve,
}: {
  incident: Incident;
  units: { vehicle: Vehicle; state?: { status: string } }[];
  unitNoun: string;
  busy: boolean;
  onSelect(): void;
  onAssign(vehicleId: string): void;
  onResolve(): void;
}) {
  const severity = SEVERITY_STYLE[incident.severity];
  const [chosen, setChosen] = useState('');

  // Only units not already committed elsewhere can be assigned.
  const available = units.filter(
    ({ vehicle, state }) =>
      !incident.assignedVehicleIds.includes(vehicle.id) &&
      (!state ||
        state.status === VehicleStatus.OFFLINE ||
        state.status === VehicleStatus.STANDBY ||
        state.status === VehicleStatus.COMPLETED),
  );

  return (
    <article className="border-b border-line px-3 py-2.5">
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="tnum font-mono text-sm font-semibold text-ink-900">{incident.code}</span>
          <div className="flex items-center gap-1.5">
            <Badge className={severity.chip}>{severity.label}</Badge>
            <Badge className="border-line bg-surface-sunken text-ink-600">{incident.status}</Badge>
          </div>
        </div>
        <p className="mt-0.5 text-xs text-ink-700">{incident.address}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">{incident.description}</p>
      </button>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field label="Reported" value={formatClock(incident.reportedAt)} mono />
        <Field label="Assigned" value={incident.assignedVehicleIds.join(', ') || '—'} mono />
        <Field label="Incident ID" value={incident.id} mono />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <select
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
          aria-label={`Assign a ${unitNoun.toLowerCase()}`}
          className="h-7 rounded-lg border border-line bg-surface-muted px-2 text-[11px] text-ink-800 outline-none focus:border-brand-500"
        >
          <option value="">Assign {unitNoun.toLowerCase()}…</option>
          {available.map(({ vehicle }) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.callSign}
            </option>
          ))}
        </select>

        <Button
          size="sm"
          variant="primary"
          disabled={busy || !chosen}
          onClick={() => {
            onAssign(chosen);
            setChosen('');
          }}
        >
          <Send className="size-3" />
          Dispatch
        </Button>

        <Button size="sm" disabled={busy} onClick={onResolve} className="ml-auto">
          <CheckCircle2 className="size-3" />
          Resolve
        </Button>
      </div>
    </article>
  );
}

function IncidentForm({
  incidentKind,
  busy,
  onCancel,
  onSubmit,
}: {
  incidentKind: IncidentKind;
  busy: boolean;
  onCancel(): void;
  onSubmit(body: {
    kind: string;
    severity: SeverityType;
    position: { lat: number; lng: number };
    address: string;
    description: string;
  }): Promise<void>;
}) {
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<SeverityType>(Severity.HIGH);
  // Central Bengaluru, so a new report lands inside the modelled network.
  const [lat, setLat] = useState('12.9718');
  const [lng, setLng] = useState('77.6035');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit({
      kind: incidentKind,
      severity,
      position: { lat: Number(lat), lng: Number(lng) },
      address: address.trim(),
      description: description.trim(),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-2 border-b border-line bg-surface-muted px-3 py-2.5">
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-500">Address</span>
          <input
            required
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Commercial building, MG Road"
            className="h-8 w-full rounded-lg border border-line bg-surface px-2 text-xs text-ink-800 outline-none focus:border-brand-500"
          />
        </label>

        <label className="col-span-2 block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-500">
            Description
          </span>
          <textarea
            required
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full resize-none rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink-800 outline-none focus:border-brand-500"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-500">Latitude</span>
          <input
            required
            value={lat}
            onChange={(event) => setLat(event.target.value)}
            className="tnum h-8 w-full rounded-lg border border-line bg-surface px-2 font-mono text-xs text-ink-800 outline-none focus:border-brand-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-500">Longitude</span>
          <input
            required
            value={lng}
            onChange={(event) => setLng(event.target.value)}
            className="tnum h-8 w-full rounded-lg border border-line bg-surface px-2 font-mono text-xs text-ink-800 outline-none focus:border-brand-500"
          />
        </label>
      </div>

      <div className="flex items-center gap-1.5">
        {([Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW] as SeverityType[]).map((option) => {
          const style = SEVERITY_STYLE[option];
          const active = severity === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setSeverity(option)}
              className={`h-7 flex-1 rounded-lg border text-[11px] font-medium ${
                active ? 'border-2' : 'border-line bg-surface text-ink-600'
              }`}
              style={active ? { borderColor: style.hex, color: style.hex, backgroundColor: `${style.hex}18` } : undefined}
            >
              {style.label}
            </button>
          );
        })}
      </div>

      <div className="flex gap-1.5">
        <Button type="submit" size="sm" variant="primary" disabled={busy} className="flex-1">
          Report incident
        </Button>
        <Button type="button" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
