import { JunctionState, Provisioning } from '@smart-er/core';
import { Badge, Card, Empty } from '@/components/ui/primitives';
import { DetailPanel } from '@/components/panels/DetailPanel';
import { ControllerLayout } from '@/components/shell/ControllerLayout';
import { useVehicleIndex } from '@/hooks/useVehicleIndex';
import { DEVICE_STATUS_STYLE, JUNCTION_STATE_STYLE } from '@/lib/status';
import { useOpsStore } from '@/stores/opsStore';

/**
 * The junction network.
 *
 * Every signalised junction with its live corridor state, the device driving
 * it, and which unit it is currently held for. This is the view a controller
 * scans to answer "what is the network doing", and the held junctions are the
 * ones that stand out.
 */
export function JunctionsPage() {
  const { vehicleById } = useVehicleIndex();
  const junctions = useOpsStore((state) => state.junctions);
  const junctionStates = useOpsStore((state) => state.junctionStates);
  const devices = useOpsStore((state) => state.devices);
  const selection = useOpsStore((state) => state.selection);
  const select = useOpsStore((state) => state.select);

  const held = junctions.filter((junction) => {
    const state = junctionStates[junction.id]?.state;
    return state === JunctionState.GREEN || state === JunctionState.PREPARING;
  }).length;

  return (
    <ControllerLayout
      title="Junctions"
      subtitle={`${junctions.length} in the network · ${held} currently held for an emergency`}
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="space-y-3">
          {/* Compact network overview — the whole network at a glance. */}
          <Card title="Network overview">
            {junctions.length === 0 ? (
              <Empty message="Network not loaded" />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                {junctions.map((junction) => {
                  const runtime = junctionStates[junction.id];
                  const state = runtime?.state ?? JunctionState.NORMAL;
                  const style = JUNCTION_STATE_STYLE[state];
                  const selected = selection?.kind === 'junction' && selection.id === junction.id;

                  return (
                    <button
                      key={junction.id}
                      type="button"
                      onClick={() => select({ kind: 'junction', id: junction.id })}
                      title={`${junction.code} — ${junction.name}`}
                      className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        selected ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:bg-surface-muted'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: style.hex }}
                          aria-hidden
                        />
                        <span className="tnum font-mono text-[13px] font-semibold text-ink-900">{junction.code}</span>
                      </div>
                      <p className="truncate text-[11px]" style={{ color: style.hex }}>
                        {style.label}
                      </p>
                      {runtime?.heldForVehicleId && (
                        <p className="tnum truncate font-mono text-[10px] text-ink-400">
                          {runtime.heldForVehicleId}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="Junction detail" noPadding>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left">
                <thead>
                  <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2 font-semibold">Junction</th>
                    <th className="px-3 py-2 font-semibold">State</th>
                    <th className="px-3 py-2 font-semibold">Controller</th>
                    <th className="px-3 py-2 font-semibold">Device</th>
                    <th className="px-4 py-2 text-right font-semibold">Throughput</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {junctions.map((junction) => {
                    const runtime = junctionStates[junction.id];
                    const state = runtime?.state ?? JunctionState.NORMAL;
                    const style = JUNCTION_STATE_STYLE[state];
                    const device = devices[junction.hardwareDeviceId];
                    const deviceStyle = device ? DEVICE_STATUS_STYLE[device.status] : undefined;
                    const selected = selection?.kind === 'junction' && selection.id === junction.id;

                    return (
                      <tr
                        key={junction.id}
                        data-selected={selected}
                        onClick={() => select({ kind: 'junction', id: junction.id })}
                        className="row-tr"
                      >
                        <td className="px-4 py-2.5">
                          <span className="tnum font-mono text-[13px] font-semibold text-ink-900">
                            {junction.code}
                          </span>
                          <p className="truncate text-[11.5px] text-ink-500">{junction.name}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge className={style.chip} dot={style.hex}>
                            {style.label}
                          </Badge>
                          {runtime?.heldForVehicleId && (
                            <p className="tnum mt-0.5 font-mono text-[11px] text-ink-500">
                              held for {runtime.heldForVehicleId}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="tnum font-mono text-[11.5px] text-ink-600">{junction.hardwareDeviceId}</p>
                          <span
                            className={`rounded border px-1.5 text-[9.5px] font-semibold uppercase tracking-wide ${
                              junction.provisioning === Provisioning.PHYSICAL
                                ? 'border-ok-200 bg-ok-50 text-ok-700'
                                : 'border-line bg-surface-sunken text-ink-500'
                            }`}
                          >
                            {junction.provisioning === Provisioning.PHYSICAL ? 'Physical' : 'Simulated'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          {deviceStyle ? (
                            <Badge className={deviceStyle.chip}>{deviceStyle.label}</Badge>
                          ) : (
                            <span className="text-[12px] text-ink-400">—</span>
                          )}
                          {runtime?.lastLatencyMs !== undefined && (
                            <p className="tnum mt-0.5 font-mono text-[10.5px] text-ink-400">
                              {runtime.lastLatencyMs} ms
                            </p>
                          )}
                        </td>
                        <td className="tnum px-4 py-2.5 text-right font-mono text-[12.5px] text-ink-600">
                          {junction.averageThroughputVph.toLocaleString()} veh/h
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card title="Detail" className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-140px)]" noPadding>
          <DetailPanel vehicleById={vehicleById} />
        </Card>
      </div>
    </ControllerLayout>
  );
}
