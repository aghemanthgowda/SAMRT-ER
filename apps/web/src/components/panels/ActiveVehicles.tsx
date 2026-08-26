import { Eye, EyeOff, Navigation, SatelliteDish } from 'lucide-react';
import type { Vehicle } from '@smart-er/core';
import { VehicleStatus, formatDistance, formatEta } from '@smart-er/core';
import { Badge, Empty } from '@/components/ui/primitives';
import { SEVERITY_STYLE, VEHICLE_KIND_COLOR, VEHICLE_STATUS_STYLE } from '@/lib/status';
import { useOpsStore } from '@/stores/opsStore';

/**
 * Active units.
 *
 * The right-hand column of the console: every unit currently signed on, with
 * the three figures a controller checks constantly — status, ETA and the next
 * junction the corridor will hold. Offline units are listed last and dimmed
 * rather than hidden, because "where is AMB-02" is a question that needs an
 * answer even when the answer is "parked".
 */
export function ActiveVehicles({ vehicleById }: { vehicleById: Map<string, Vehicle> }) {
  const vehicles = useOpsStore((state) => state.vehicles);
  const requests = useOpsStore((state) => state.requests);
  const corridors = useOpsStore((state) => state.corridors);
  const junctions = useOpsStore((state) => state.junctions);
  const selection = useOpsStore((state) => state.selection);
  const select = useOpsStore((state) => state.select);
  const hidden = useOpsStore((state) => state.hiddenVehicleIds);
  const toggleVisibility = useOpsStore((state) => state.toggleVehicleVisibility);

  const rank: Record<string, number> = {
    [VehicleStatus.ACTIVE]: 0,
    [VehicleStatus.REROUTING]: 1,
    [VehicleStatus.REQUESTED]: 2,
    [VehicleStatus.ARRIVED]: 3,
    [VehicleStatus.STANDBY]: 4,
    [VehicleStatus.COMPLETED]: 5,
    [VehicleStatus.OFFLINE]: 6,
  };

  const rows = Object.values(vehicles).sort(
    (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.vehicleId.localeCompare(b.vehicleId),
  );

  if (rows.length === 0) {
    return <Empty message="No units registered" />;
  }

  const junctionCode = (junctionId?: string) =>
    junctionId ? (junctions.find((junction) => junction.id === junctionId)?.code ?? junctionId) : undefined;

  return (
    <div>
      {rows.map((state) => {
        const vehicle = vehicleById.get(state.vehicleId);
        const style = VEHICLE_STATUS_STYLE[state.status];
        const request = state.activeRequestId ? requests[state.activeRequestId] : undefined;
        const corridor = state.corridorId ? corridors[state.corridorId] : undefined;
        const selected = selection?.kind === 'vehicle' && selection.id === state.vehicleId;
        const isHidden = hidden.has(state.vehicleId);
        const offline = state.status === VehicleStatus.OFFLINE;

        return (
          <div
            key={state.vehicleId}
            data-selected={selected}
            className={`row-button cursor-pointer px-2.5 py-2 ${offline ? 'opacity-55' : ''}`}
            onClick={() => select({ kind: 'vehicle', id: state.vehicleId })}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: vehicle ? VEHICLE_KIND_COLOR[vehicle.kind] : '#6b8098' }}
                  aria-hidden
                />
                <span className="tnum truncate font-mono text-xs font-semibold text-ground-50">
                  {vehicle?.callSign ?? state.vehicleId}
                </span>
                {!state.gpsOk && !offline && (
                  <SatelliteDish className="size-3 shrink-0 text-violet-400" aria-label="GPS lock lost" />
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Badge className={style.chip}>{style.label}</Badge>
                <button
                  type="button"
                  aria-label={isHidden ? `Show ${state.vehicleId} on map` : `Hide ${state.vehicleId} on map`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleVisibility(state.vehicleId);
                  }}
                  className="text-ground-500 transition-colors hover:text-ground-200"
                >
                  {isHidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                </button>
              </div>
            </div>

            {!offline && (
              <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-3.5">
                {state.etaSeconds !== undefined && (
                  <>
                    <span className="text-[10px] uppercase tracking-wider text-ground-500">ETA</span>
                    <span className="tnum font-mono text-[11px] text-ground-100">
                      {formatEta(state.etaSeconds)}
                      {state.distanceRemainingM !== undefined && (
                        <span className="ml-1.5 text-ground-400">{formatDistance(state.distanceRemainingM)}</span>
                      )}
                    </span>
                  </>
                )}

                {state.nextJunctionId && (
                  <>
                    <span className="text-[10px] uppercase tracking-wider text-ground-500">Next</span>
                    <span className="flex items-center gap-1 text-[11px] text-ground-200">
                      <Navigation className="size-2.5 text-ground-400" />
                      {junctionCode(state.nextJunctionId)}
                      {corridor?.activeJunctionId === state.nextJunctionId && (
                        <span className="text-status-ok">· green</span>
                      )}
                      {corridor?.preparingJunctionIds.includes(state.nextJunctionId ?? '') && (
                        <span className="text-status-high">· preparing</span>
                      )}
                    </span>
                  </>
                )}

                {request && (
                  <>
                    <span className="text-[10px] uppercase tracking-wider text-ground-500">To</span>
                    <span className="flex items-center gap-1.5 truncate text-[11px] text-ground-200">
                      <span className="truncate">{request.destination.name}</span>
                      <Badge className={SEVERITY_STYLE[request.severity].chip}>
                        {SEVERITY_STYLE[request.severity].label}
                      </Badge>
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
