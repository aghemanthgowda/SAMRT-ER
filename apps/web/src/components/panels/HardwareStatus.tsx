import { Cpu, Radio } from 'lucide-react';
import { DeviceKind, DeviceStatus, HardwareMode } from '@smart-er/core';
import { Badge, Empty } from '@/components/ui/primitives';
import { DEVICE_STATUS_STYLE } from '@/lib/status';
import { useOpsStore } from '@/stores/opsStore';

/**
 * Hardware / simulation status.
 *
 * Reports what is behind the hardware abstraction layer right now. In Phase 1
 * every device is simulated, and the panel says so rather than implying a
 * junction controller is a real ESP32 on a pole. When Phase 2 replaces
 * individual devices, the mode badge changes per device and nothing else here
 * needs to.
 */
export function HardwareStatus() {
  const devices = useOpsStore((state) => state.devices);
  const junctionStates = useOpsStore((state) => state.junctionStates);

  const list = Object.values(devices).sort((a, b) => a.serial.localeCompare(b.serial));
  if (list.length === 0) return <Empty message="No devices registered" />;

  const junctionControllers = list.filter((device) => device.kind === DeviceKind.JUNCTION_CONTROLLER);
  const vehicleUnits = list.filter((device) => device.kind === DeviceKind.VEHICLE_UNIT);
  const offline = list.filter((device) => device.status === DeviceStatus.OFFLINE).length;
  const simulated = list.filter((device) => device.mode === HardwareMode.SIMULATED).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-ground-800 px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] text-ground-300">
          <Cpu className="size-3 text-ground-400" />
          {list.length} devices
        </span>
        <div className="flex items-center gap-1.5">
          {simulated > 0 && (
            <Badge className="border-accent-500/40 bg-accent-500/15 text-accent-400">
              {simulated === list.length ? 'All simulated' : `${simulated} simulated`}
            </Badge>
          )}
          {offline > 0 && (
            <Badge className={DEVICE_STATUS_STYLE[DeviceStatus.OFFLINE].chip}>{offline} offline</Badge>
          )}
        </div>
      </div>

      <DeviceGroup
        title="Junction controllers"
        devices={junctionControllers}
        detail={(device) => {
          const junctionId = device.boundEntityId ?? '';
          const runtime = junctionStates[junctionId];
          return runtime ? `${runtime.code} · ${runtime.aspect}` : junctionId;
        }}
      />
      <DeviceGroup title="Vehicle units" devices={vehicleUnits} detail={(device) => device.boundEntityId ?? ''} />
    </div>
  );
}

function DeviceGroup({
  title,
  devices,
  detail,
}: {
  title: string;
  devices: { id: string; serial: string; status: DeviceStatus; mode: HardwareMode; lastLatencyMs?: number; boundEntityId?: string }[];
  detail(device: { boundEntityId?: string }): string;
}) {
  if (devices.length === 0) return null;

  return (
    <section>
      <h3 className="border-b border-ground-800 bg-ground-850/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-ground-400">
        {title}
      </h3>
      <ul>
        {devices.map((device) => {
          const style = DEVICE_STATUS_STYLE[device.status];
          return (
            <li
              key={device.id}
              className="flex items-center justify-between gap-2 border-b border-ground-800 px-2.5 py-1"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: style.hex }} aria-hidden />
                <span className="tnum truncate font-mono text-[11px] text-ground-100">{device.serial}</span>
                <span className="truncate text-[10px] text-ground-500">{detail(device)}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {device.lastLatencyMs !== undefined && (
                  <span className="tnum font-mono text-[10px] text-ground-500" title="Last acknowledgement latency">
                    {device.lastLatencyMs}ms
                  </span>
                )}
                {device.mode === HardwareMode.SIMULATED ? (
                  <Radio className="size-3 text-accent-400" aria-label="Simulated device" />
                ) : (
                  <Cpu className="size-3 text-status-ok" aria-label="Physical device" />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
