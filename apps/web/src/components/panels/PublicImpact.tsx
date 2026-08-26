import { formatEta } from '@smart-er/core';
import { Badge, Meter } from '@/components/ui/primitives';
import { IMPACT_STYLE } from '@/lib/status';
import { useOpsStore } from '@/stores/opsStore';

/**
 * Public traffic impact.
 *
 * A green corridor is bought with everyone else's time, and this panel is where
 * that cost is stated plainly. It is the number that justifies the rolling
 * window: two junctions held out of fourteen is a very different intervention
 * from fourteen, and without this display the difference is invisible.
 */
export function PublicImpact() {
  const impact = useOpsStore((state) => state.impact);
  const junctions = useOpsStore((state) => state.junctions);

  const style = IMPACT_STYLE[impact?.level ?? 'NONE'];
  const active = impact?.activeEmergencyJunctions ?? 0;
  const total = impact?.totalJunctions ?? junctions.length;

  return (
    <div className="space-y-2.5 px-2.5 py-2">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-ground-400">
            Emergency junctions
          </span>
          <span className="tnum font-mono text-sm font-semibold text-ground-50">
            {active}
            <span className="text-ground-500"> / {total}</span>
          </span>
        </div>
        <Meter value={active} max={total} color={style.hex} className="mt-1" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-ground-400">Impact</p>
          <Badge className={`${style.chip} mt-0.5`}>{style.label}</Badge>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-ground-400">Added delay</p>
          <p className="tnum font-mono text-sm text-ground-50">
            {impact?.estimatedAdditionalDelaySeconds ?? 0}
            <span className="text-[11px] text-ground-400"> s</span>
          </p>
        </div>
      </div>

      {impact && impact.totalVehicleSecondsLost > 0 && (
        <p className="tnum border-t border-ground-800 pt-1.5 font-mono text-[10px] text-ground-500">
          {impact.totalVehicleSecondsLost.toLocaleString()} vehicle-seconds ≈ {formatEta(impact.totalVehicleSecondsLost)}
          <span className="ml-1 font-sans">of aggregate public delay</span>
        </p>
      )}

      {impact && impact.affectedJunctionIds.length > 0 && (
        <p className="tnum font-mono text-[10px] text-ground-400">
          Holding {impact.affectedJunctionIds.join(', ')}
        </p>
      )}
    </div>
  );
}
