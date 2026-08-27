import { JunctionState } from '@smart-er/core';
import { Empty } from '@/components/ui/primitives';
import { JUNCTION_STATE_STYLE } from '@/lib/status';
import { useOpsStore } from '@/stores/opsStore';

/**
 * Junction network strip.
 *
 * Every junction as a compact tile, coloured by state. This is the display a
 * controller scans to answer "what is the network doing right now" — held
 * junctions are the ones that stand out, and everything normal recedes.
 */
export function JunctionNetwork() {
  const junctions = useOpsStore((state) => state.junctions);
  const junctionStates = useOpsStore((state) => state.junctionStates);
  const selection = useOpsStore((state) => state.selection);
  const select = useOpsStore((state) => state.select);

  if (junctions.length === 0) return <Empty message="Network not loaded" />;

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1 p-1.5">
      {junctions.map((junction) => {
        const runtime = junctionStates[junction.id];
        const state = runtime?.state ?? JunctionState.NORMAL;
        const style = JUNCTION_STATE_STYLE[state];
        const selected = selection?.kind === 'junction' && selection.id === junction.id;
        const held = state === JunctionState.GREEN || state === JunctionState.PREPARING;

        return (
          <button
            key={junction.id}
            type="button"
            onClick={() => select({ kind: 'junction', id: junction.id })}
            title={`${junction.code} — ${junction.name} (${style.label})`}
            className={`rounded-lg border px-1.5 py-1 text-left transition-colors ${
              selected ? 'border-brand-500 bg-surface-sunken' : 'border-line bg-surface-muted hover:bg-surface-muted'
            }`}
          >
            <div className="flex items-center gap-1">
              <span
                className={`size-1.5 shrink-0 rounded-full ${held ? 'ring-2 ring-offset-0' : ''}`}
                style={{ backgroundColor: style.hex, boxShadow: held ? `0 0 0 2px ${style.hex}40` : undefined }}
                aria-hidden
              />
              <span className="tnum font-mono text-[11px] font-semibold text-ink-800">{junction.code}</span>
            </div>
            <p className="truncate text-[9px] uppercase tracking-wide" style={{ color: style.hex }}>
              {style.label}
            </p>
            {runtime?.heldForVehicleId && (
              <p className="tnum truncate font-mono text-[9px] text-ink-500">{runtime.heldForVehicleId}</p>
            )}
          </button>
        );
      })}
    </div>
  );
}
