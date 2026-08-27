import { Ambulance, Flame, SatelliteDish, ShieldCheck } from 'lucide-react';
import { Provisioning, VehicleKind, VehicleStatus, formatDistance, formatEta } from '@smart-er/core';
import { Badge, Card, Empty } from '@/components/ui/primitives';
import { DetailPanel } from '@/components/panels/DetailPanel';
import { ControllerLayout } from '@/components/shell/ControllerLayout';
import { useVehicleIndex } from '@/hooks/useVehicleIndex';
import { SEVERITY_STYLE, VEHICLE_KIND_COLOR, VEHICLE_STATUS_STYLE } from '@/lib/status';
import { useOpsStore } from '@/stores/opsStore';

const KIND_ICON = {
  [VehicleKind.AMBULANCE]: Ambulance,
  [VehicleKind.FIRE_TRUCK]: Flame,
  [VehicleKind.POLICE_UNIT]: ShieldCheck,
} as const;

/**
 * The vehicle register.
 *
 * Every registered unit, running or not, with its identity chain and live
 * state. The PHYSICAL / SIMULATED badge is load-bearing: during the hardware
 * demonstration a real prototype and a simulated fleet will be on the same
 * map, and a controller must never have to guess which is which.
 */
export function VehiclesPage() {
  const { vehicles, loading } = useVehicleIndex();
  const { vehicleById } = useVehicleIndex();
  const states = useOpsStore((state) => state.vehicles);
  const requests = useOpsStore((state) => state.requests);
  const selection = useOpsStore((state) => state.selection);
  const select = useOpsStore((state) => state.select);

  const rank: Record<string, number> = {
    [VehicleStatus.ACTIVE]: 0,
    [VehicleStatus.REROUTING]: 1,
    [VehicleStatus.REQUESTED]: 2,
    [VehicleStatus.ARRIVED]: 3,
    [VehicleStatus.STANDBY]: 4,
    [VehicleStatus.COMPLETED]: 5,
    [VehicleStatus.OFFLINE]: 6,
  };

  const rows = [...vehicles].sort((a, b) => {
    const sa = states[a.id]?.status ?? VehicleStatus.OFFLINE;
    const sb = states[b.id]?.status ?? VehicleStatus.OFFLINE;
    return (rank[sa] ?? 9) - (rank[sb] ?? 9) || a.callSign.localeCompare(b.callSign);
  });

  const activeCount = rows.filter((vehicle) => {
    const status = states[vehicle.id]?.status;
    return status === VehicleStatus.ACTIVE || status === VehicleStatus.REROUTING;
  }).length;

  return (
    <ControllerLayout title="Vehicles" subtitle={`${rows.length} registered · ${activeCount} running`}>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <Card title="Registered units" noPadding>
          {loading ? (
            <Empty message="Loading register" />
          ) : rows.length === 0 ? (
            <Empty message="No vehicles registered" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead>
                  <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-500">
                    <th className="w-[168px] px-4 py-2 font-semibold">Unit</th>
                    <th className="px-3 py-2 font-semibold">Operator</th>
                    <th className="px-3 py-2 font-semibold">Device</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">ETA</th>
                    <th className="px-4 py-2 text-right font-semibold">Remaining</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((vehicle) => {
                    const state = states[vehicle.id];
                    const request = state?.activeRequestId ? requests[state.activeRequestId] : undefined;
                    const status = VEHICLE_STATUS_STYLE[state?.status ?? VehicleStatus.OFFLINE];
                    const Icon = KIND_ICON[vehicle.kind];
                    const color = VEHICLE_KIND_COLOR[vehicle.kind];
                    const selected = selection?.kind === 'vehicle' && selection.id === vehicle.id;

                    return (
                      <tr
                        key={vehicle.id}
                        data-selected={selected}
                        onClick={() => select({ kind: 'vehicle', id: vehicle.id })}
                        className="row-tr"
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <Icon className="size-4 shrink-0" style={{ color }} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="tnum whitespace-nowrap font-mono text-[13px] font-semibold text-ink-900">
                                  {vehicle.callSign}
                                </span>
                                {!state?.gpsOk && state?.status !== VehicleStatus.OFFLINE && (
                                  <SatelliteDish className="size-3 text-violet-500" aria-label="GPS lock lost" />
                                )}
                              </div>
                              <p className="tnum whitespace-nowrap font-mono text-[11px] text-ink-400">{vehicle.registrationNumber}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="truncate text-[12.5px] text-ink-700">{vehicle.organization?.name ?? '—'}</p>
                          {request && (
                            <Badge className={SEVERITY_STYLE[request.severity].chip}>
                              {SEVERITY_STYLE[request.severity].label}
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="tnum font-mono text-[11.5px] text-ink-600">{vehicle.hardwareDeviceId}</p>
                          <span
                            className={`rounded border px-1.5 text-[9.5px] font-semibold uppercase tracking-wide ${
                              vehicle.provisioning === Provisioning.PHYSICAL
                                ? 'border-ok-200 bg-ok-50 text-ok-700'
                                : 'border-line bg-surface-sunken text-ink-500'
                            }`}
                          >
                            {vehicle.provisioning === Provisioning.PHYSICAL ? 'Physical' : 'Simulated'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge className={status.chip}>{status.label}</Badge>
                          {request && (
                            <p className="mt-0.5 truncate text-[11px] text-ink-500">{request.destination.name}</p>
                          )}
                        </td>
                        <td className="tnum px-3 py-2.5 text-right font-mono text-[13px] text-ink-800">
                          {formatEta(state?.etaSeconds)}
                        </td>
                        <td className="tnum px-4 py-2.5 text-right font-mono text-[12.5px] text-ink-600">
                          {formatDistance(state?.distanceRemainingM)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Detail" className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-140px)]" noPadding>
          <DetailPanel vehicleById={vehicleById} />
        </Card>
      </div>
    </ControllerLayout>
  );
}
