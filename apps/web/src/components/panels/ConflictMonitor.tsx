import { ShieldCheck } from 'lucide-react';
import { formatClock, formatEta } from '@smart-er/core';
import { Badge, Empty } from '@/components/ui/primitives';
import { CONFLICT_STATUS_STYLE } from '@/lib/status';
import { useOpsStore, useConflictList } from '@/stores/opsStore';

/**
 * Conflict monitor.
 *
 * Shows every junction contention SMART-ER has detected and what it did about
 * it. The explanation is rendered in full rather than summarised, because the
 * point of the panel is that a controller can justify the decision afterwards —
 * "the system rerouted the fire appliance" is not a defensible answer, and
 * "J2 was held for AMB-01 until 10:32:18, so FIRE-01 took the Double Road
 * alternative and arrived 25 s earlier than waiting" is.
 */
export function ConflictMonitor() {
  const conflicts = useConflictList();
  const selection = useOpsStore((state) => state.selection);
  const select = useOpsStore((state) => state.select);

  if (conflicts.length === 0) {
    return (
      <Empty
        icon={<ShieldCheck className="size-5" />}
        message="No junction conflicts"
        hint="Contention is detected when two corridors need the same junction inside one clearance window."
      />
    );
  }

  return (
    <div>
      {conflicts.map((conflict) => {
        const style = CONFLICT_STATUS_STYLE[conflict.status];
        const selected = selection?.kind === 'conflict' && selection.id === conflict.id;
        const saved = conflict.timeSavedSeconds;

        return (
          <article
            key={conflict.id}
            data-selected={selected}
            className="row-button cursor-pointer px-2.5 py-2"
            onClick={() => select({ kind: 'conflict', id: conflict.id })}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="tnum font-mono text-xs font-semibold text-ink-900">{conflict.junctionId}</span>
                <span className="tnum font-mono text-[11px] text-ink-600">
                  {conflict.primaryVehicleId} / {conflict.secondaryVehicleId}
                </span>
              </div>
              <Badge className={style.chip}>{style.label}</Badge>
            </div>

            <p className="mt-1 text-[11px] leading-relaxed text-ink-600">{conflict.explanation}</p>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="tnum font-mono text-[10px] text-ink-9000">
                headway {conflict.headwaySeconds}s · {formatClock(conflict.detectedAt)}
              </span>
              {conflict.originalEtaSeconds !== undefined && conflict.newEtaSeconds !== undefined && (
                <span className="tnum font-mono text-[10px] text-ink-500">
                  ETA {formatEta(conflict.originalEtaSeconds)} → {formatEta(conflict.newEtaSeconds)}
                </span>
              )}
              {saved !== undefined && saved > 0 && (
                <span className="tnum font-mono text-[10px] font-semibold text-ok-600">saved {saved}s</span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
