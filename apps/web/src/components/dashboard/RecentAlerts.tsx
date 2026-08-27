import { AlertTriangle, Info, Radio } from 'lucide-react';
import { formatClock } from '@smart-er/core';
import type { OperationalAlert } from '@/api/client';
import { Empty } from '@/components/ui/primitives';

/**
 * Recent operational alerts.
 *
 * Every entry is a real event pulled from the incident timeline — a conflict
 * that was detected, a reroute that happened, a controller that stopped
 * answering. Nothing here is a placeholder, so an empty list genuinely means a
 * quiet network rather than a panel that was never wired up.
 */
const SEVERITY = {
  critical: { icon: AlertTriangle, tone: 'text-critical-600', bg: 'bg-critical-50' },
  warning: { icon: Radio, tone: 'text-warn-600', bg: 'bg-warn-50' },
  info: { icon: Info, tone: 'text-info-600', bg: 'bg-info-50' },
} as const;

export function RecentAlerts({ alerts, loading }: { alerts: OperationalAlert[]; loading: boolean }) {
  if (loading && alerts.length === 0) {
    return (
      <ul className="divide-y divide-line">
        {[0, 1, 2].map((row) => (
          <li key={row} className="flex gap-2.5 px-4 py-2.5">
            <span className="size-7 shrink-0 animate-pulse rounded-lg bg-surface-sunken" />
            <span className="h-3 flex-1 animate-pulse rounded bg-surface-sunken" />
          </li>
        ))}
      </ul>
    );
  }

  if (alerts.length === 0) {
    return (
      <Empty
        message="No alerts"
        hint="Conflicts, reroutes and device faults are raised here as they happen."
      />
    );
  }

  return (
    <ul className="divide-y divide-line">
      {alerts.map((alert) => {
        const style = SEVERITY[alert.severity];
        const Icon = style.icon;
        return (
          <li key={alert.id} className="flex gap-2.5 px-4 py-2.5">
            <div className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${style.bg} ${style.tone}`}>
              <Icon className="size-[15px]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] leading-snug text-ink-700">{alert.message}</p>
              <p className="tnum mt-0.5 font-mono text-[10.5px] text-ink-400">
                {formatClock(alert.at)}
                {alert.junctionId && ` · ${alert.junctionId}`}
                {alert.vehicleId && ` · ${alert.vehicleId}`}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
