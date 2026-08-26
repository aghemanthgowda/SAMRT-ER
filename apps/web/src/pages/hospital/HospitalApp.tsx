import { useState } from 'react';
import { Ambulance, CheckCircle2, ClipboardCheck, Clock, MapPin, SatelliteDish } from 'lucide-react';
import type { Vehicle } from '@smart-er/core';
import { RequestStatus, VehicleStatus, formatClock, formatDistance, formatEta } from '@smart-er/core';
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
 * Hospital emergency desk.
 *
 * The receiving end of an ambulance run. A hospital does not need the whole
 * network — it needs to know what is coming, how bad it is, and how long it
 * has to prepare. So the inbound list is the primary display and the map is
 * supporting context, which is the reverse of the controller console.
 *
 * Inbound units arrive here automatically the moment the controller approves;
 * nobody has to radio ahead.
 */
export function HospitalApp() {
  useRealtime();
  const { vehicleById } = useVehicleIndex();
  const facility = useAuthStore((state) => state.facility);

  const requests = useOpsStore((state) => state.requests);
  const vehicles = useOpsStore((state) => state.vehicles);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [prepared, setPrepared] = useState<Set<string>>(new Set());

  // Everything currently routed to this facility, closest arrival first.
  const inbound = Object.values(requests)
    .filter(
      (request) =>
        request.destination.facilityId === facility?.id &&
        (request.status === RequestStatus.APPROVED || request.status === RequestStatus.PENDING),
    )
    .sort((a, b) => {
      const etaA = vehicles[a.vehicleId]?.etaSeconds ?? Number.MAX_SAFE_INTEGER;
      const etaB = vehicles[b.vehicleId]?.etaSeconds ?? Number.MAX_SAFE_INTEGER;
      return etaA - etaB;
    });

  const arrived = Object.values(requests)
    .filter(
      (request) =>
        request.destination.facilityId === facility?.id &&
        request.status === RequestStatus.COMPLETED &&
        vehicles[request.vehicleId]?.status === VehicleStatus.ARRIVED,
    )
    .slice(-5);

  const confirmArrival = async (requestId: string) => {
    setBusyId(requestId);
    try {
      await api.confirmArrival(requestId);
    } finally {
      setBusyId(undefined);
    }
  };

  const markPrepared = (requestId: string) => {
    setPrepared((current) => new Set(current).add(requestId));
  };

  return (
    <div className="flex h-full flex-col bg-ground-950">
      <TopBar subtitle={facility?.name ?? 'Hospital emergency desk'}>
        <div className="hidden items-center gap-2 lg:flex">
          <Ambulance className="size-3.5 text-status-critical" />
          <span className="text-[10px] uppercase tracking-wider text-ground-500">Inbound</span>
          <span className="tnum font-mono text-xs font-semibold text-ground-100">{inbound.length}</span>
        </div>
      </TopBar>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-1.5 p-1.5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* Inbound — the primary display */}
        <div className="grid min-h-0 grid-rows-[minmax(0,1.4fr)_minmax(0,1fr)] gap-1.5">
          <Panel title="Incoming emergencies">
            {inbound.length === 0 ? (
              <Empty
                icon={<CheckCircle2 className="size-5" />}
                message="No inbound emergencies"
                hint="Ambulances appear here automatically once the control room approves their corridor."
              />
            ) : (
              <div>
                {inbound.map((request) => {
                  const state = vehicles[request.vehicleId];
                  const vehicle: Vehicle | undefined = vehicleById.get(request.vehicleId);
                  const severity = SEVERITY_STYLE[request.severity];
                  const statusStyle = state ? VEHICLE_STATUS_STYLE[state.status] : undefined;
                  const isPrepared = prepared.has(request.id);

                  return (
                    <article
                      key={request.id}
                      className={`border-b border-ground-800 px-3 py-2.5 ${
                        request.severity === 'CRITICAL' ? 'border-l-2 border-l-status-critical' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="tnum font-mono text-sm font-semibold text-ground-50">
                              {request.vehicleId}
                            </span>
                            <Badge className={severity.chip}>{severity.label}</Badge>
                            {statusStyle && <Badge className={statusStyle.chip}>{statusStyle.label}</Badge>}
                            {request.status === RequestStatus.PENDING && (
                              <Badge className="border-ground-600 bg-ground-800 text-ground-300">
                                Awaiting approval
                              </Badge>
                            )}
                            {state && !state.gpsOk && (
                              <span className="flex items-center gap-1 text-[10px] text-violet-400">
                                <SatelliteDish className="size-3" />
                                GPS lost
                              </span>
                            )}
                          </div>

                          {request.note && (
                            <p className="mt-1 text-xs italic leading-relaxed text-ground-300">{request.note}</p>
                          )}

                          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <Field label="ETA" value={formatEta(state?.etaSeconds)} mono />
                            <Field label="Distance" value={formatDistance(state?.distanceRemainingM)} mono />
                            <Field label="Driver" value={request.driverId} mono />
                            <Field
                              label="Operator"
                              value={vehicle?.organizationId ?? request.organizationId}
                              mono
                            />
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-col gap-1.5">
                          <Button
                            size="sm"
                            variant={isPrepared ? 'default' : 'primary'}
                            disabled={isPrepared}
                            onClick={() => markPrepared(request.id)}
                          >
                            <ClipboardCheck className="size-3" />
                            {isPrepared ? 'Bay ready' : 'Prepare bay'}
                          </Button>
                          <Button
                            size="sm"
                            variant="success"
                            disabled={busyId === request.id || state?.status !== VehicleStatus.ARRIVED}
                            onClick={() => void confirmArrival(request.id)}
                            title={
                              state?.status === VehicleStatus.ARRIVED
                                ? 'Confirm the unit has arrived'
                                : 'Available once the unit reaches the hospital'
                            }
                          >
                            <CheckCircle2 className="size-3" />
                            Arrived
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title="Recent arrivals">
            {arrived.length === 0 ? (
              <Empty message="No arrivals yet today" />
            ) : (
              <ul>
                {arrived.map((request) => (
                  <li
                    key={request.id}
                    className="flex items-center justify-between gap-2 border-b border-ground-800 px-3 py-2 last:border-b-0"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="size-3.5 text-status-ok" />
                      <span className="tnum font-mono text-xs text-ground-100">{request.vehicleId}</span>
                      <Badge className={SEVERITY_STYLE[request.severity].chip}>
                        {SEVERITY_STYLE[request.severity].label}
                      </Badge>
                    </div>
                    <time className="tnum font-mono text-[11px] text-ground-400">
                      {request.completedAt ? formatClock(request.completedAt) : '—'}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* Map and timeline — supporting context */}
        <div className="grid min-h-0 grid-rows-[minmax(0,1.3fr)_minmax(0,1fr)] gap-1.5">
          <Panel title="Live tracking" bodyClassName="relative overflow-hidden" className="min-h-[260px]">
            <OperationsMap vehicleById={vehicleById} className="absolute inset-0" />
          </Panel>
          <Panel title="Event timeline">
            <IncidentTimeline />
          </Panel>
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-4 border-t border-ground-700 bg-ground-900 px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] text-ground-400">
          <MapPin className="size-3" />
          {facility?.address ?? '—'}
        </span>
        {facility?.capacity !== undefined && (
          <span className="flex items-center gap-1.5 text-[11px] text-ground-400">
            <Clock className="size-3" />
            {facility.capacity} emergency bays
          </span>
        )}
        {facility?.specialities && (
          <span className="hidden text-[11px] text-ground-500 sm:inline">{facility.specialities.join(' · ')}</span>
        )}
      </footer>
    </div>
  );
}
