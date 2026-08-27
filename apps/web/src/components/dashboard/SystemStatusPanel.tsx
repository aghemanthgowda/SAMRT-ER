import type { ServiceStatus } from '@smart-er/core';
import { Empty, StatusDot } from '@/components/ui/primitives';

/**
 * Service health.
 *
 * Every row is computed server-side from live state. Nothing here is a
 * constant, and there is no "all systems operational" summary line: a status
 * panel that cannot report a fault is worse than no status panel, because the
 * operator stops checking anything else.
 */
const STATE_STYLE: Record<ServiceStatus['state'], { color: string; label: string; text: string }> = {
  ONLINE: { color: '#12b76a', label: 'Online', text: 'text-ok-600' },
  DEGRADED: { color: '#f59e0b', label: 'Degraded', text: 'text-warn-600' },
  OFFLINE: { color: '#ef4444', label: 'Offline', text: 'text-critical-600' },
  UNKNOWN: { color: '#98a2b3', label: 'Unknown', text: 'text-ink-400' },
};

export function SystemStatusPanel({ statuses, loading }: { statuses: ServiceStatus[]; loading: boolean }) {
  if (loading && statuses.length === 0) {
    return (
      <ul className="divide-y divide-line">
        {[0, 1, 2, 3, 4].map((row) => (
          <li key={row} className="flex items-center justify-between px-4 py-2.5">
            <span className="h-3 w-28 animate-pulse rounded bg-surface-sunken" />
            <span className="h-3 w-14 animate-pulse rounded bg-surface-sunken" />
          </li>
        ))}
      </ul>
    );
  }

  if (statuses.length === 0) {
    return <Empty message="Status unavailable" hint="The server did not report subsystem health." />;
  }

  return (
    <ul className="divide-y divide-line">
      {statuses.map((service) => {
        const style = STATE_STYLE[service.state];
        return (
          <li key={service.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <StatusDot color={style.color} pulse={service.state === 'OFFLINE'} />
              <span className="truncate text-[13px] text-ink-700">{service.label}</span>
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-[12.5px] font-medium ${style.text}`}>{style.label}</p>
              <p className="text-[10.5px] text-ink-400">{service.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
