import { useNavigate } from 'react-router-dom';
import { Ambulance, Flame, ShieldCheck, SatelliteDish } from 'lucide-react';
import type { Vehicle } from '@smart-er/core';
import { Provisioning, VehicleKind, VehicleStatus, formatEta } from '@smart-er/core';
import { Badge, CardLink, Empty } from '@/components/ui/primitives';
import { SEVERITY_STYLE, VEHICLE_KIND_COLOR, VEHICLE_STATUS_STYLE } from '@/lib/status';
import { VehicleImage } from '@/components/brand/VehicleImage';
import { useOpsStore } from '@/stores/opsStore';

const KIND_ICON = {
  [VehicleKind.AMBULANCE]: Ambulance,
  [VehicleKind.FIRE_TRUCK]: Flame,
  [VehicleKind.POLICE_UNIT]: ShieldCheck,
} as const;

const KIND_LABEL = {
  [VehicleKind.AMBULANCE]: 'Ambulance',
  [VehicleKind.FIRE_TRUCK]: 'Fire truck',
  [VehicleKind.POLICE_UNIT]: 'Police unit',
} as const;

/**
 * Units currently running, alongside the map.
 *
 * Ordered by ETA — the unit arriving soonest is the one whose corridor is
 * about to free up, and the one a controller is most likely to act on next.
 * Clicking a row selects it on the map and opens its detail.
 */
export function ActiveEmergencies({ vehicleById }: { vehicleById: Map<string, Vehicle> }) {
  const navigate = useNavigate();
  const vehicles = useOpsStore((state) => state.vehicles);
  const requests = useOpsStore((state) => state.requests);
  const selection = useOpsStore((state) => state.selection);
  const select = useOpsStore((state) => state.select);

  const active = Object.values(vehicles)
    .filter(
      (state) =>
        state.status === VehicleStatus.ACTIVE ||
        state.status === VehicleStatus.REROUTING ||
        state.status === VehicleStatus.REQUESTED ||
        state.status === VehicleStatus.ARRIVED,
    )
    .sort((a, b) => (a.etaSeconds ?? Number.MAX_SAFE_INTEGER) - (b.etaSeconds ?? Number.MAX_SAFE_INTEGER));

  return (
    <section className="card min-h-0">
      <header className="card-header">
        <h2 className="card-title">Active emergencies</h2>
        <CardLink onClick={() => navigate('/controller/vehicles')}>View all</CardLink>
      </header>

      <div className="card-body">
        {active.length === 0 ? (
          <Empty
            message="No active emergencies"
            hint="Units appear here as soon as a corridor request is approved."
          />
        ) : (
          <ul className="divide-y divide-line">
            {active.map((state) => {
              const vehicle = vehicleById.get(state.vehicleId);
              const request = state.activeRequestId ? requests[state.activeRequestId] : undefined;
              const Icon = vehicle ? KIND_ICON[vehicle.kind] : Ambulance;
              const color = vehicle ? VEHICLE_KIND_COLOR[vehicle.kind] : '#667085';
              const statusStyle = VEHICLE_STATUS_STYLE[state.status];
              const selected = selection?.kind === 'vehicle' && selection.id === state.vehicleId;

              return (
                <li key={state.vehicleId}>
                  <button
                    type="button"
                    data-selected={selected}
                    onClick={() => select({ kind: 'vehicle', id: state.vehicleId })}
                    className="row-button px-4 py-3"
                  >
                    <div className="flex items-start gap-3">
                      {/* The artwork stands on its own — no tinted disc behind it. */}
                      {vehicle ? (
                        <VehicleImage kind={vehicle.kind} />
                      ) : (
                        <div className="flex size-9 shrink-0 items-center justify-center" style={{ color }}>
                          <Icon className="size-[18px]" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="tnum font-mono text-[14px] font-semibold" style={{ color }}>
                            {vehicle?.callSign ?? state.vehicleId}
                          </span>
                          {vehicle?.provisioning === Provisioning.PHYSICAL && (
                            <span className="rounded border border-line bg-surface-sunken px-1 text-[9px] font-semibold uppercase tracking-wide text-ink-500">
                              Physical
                            </span>
                          )}
                          {!state.gpsOk && (
                            <SatelliteDish className="size-3 text-violet-500" aria-label="GPS lock lost" />
                          )}
                        </div>
                        <p className="truncate text-[12px] text-ink-500">
                          {vehicle ? KIND_LABEL[vehicle.kind] : 'Unit'}
                        </p>
                        <p className="truncate text-[12.5px] font-medium text-ink-800">
                          {request?.destination.name ?? '—'}
                        </p>
                        <Badge className={`${statusStyle.chip} mt-1.5`}>{statusStyle.label}</Badge>
                      </div>

                      <div className="grid shrink-0 grid-cols-2 gap-x-4 text-right">
                        <div>
                          <p className="text-[10.5px] uppercase tracking-wide text-ink-400">ETA</p>
                          <p className="tnum font-mono text-[14px] font-semibold text-ink-900">
                            {formatEta(state.etaSeconds)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10.5px] uppercase tracking-wide text-ink-400">Priority</p>
                          <p
                            className="text-[13px] font-semibold"
                            style={{ color: request ? SEVERITY_STYLE[request.severity].hex : '#667085' }}
                          >
                            {request ? SEVERITY_STYLE[request.severity].label : '—'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
