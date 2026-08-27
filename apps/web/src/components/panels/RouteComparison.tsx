import type { Route } from '@smart-er/core';
import { RouteSource, formatDistance, formatEta } from '@smart-er/core';
import { Badge } from '@/components/ui/primitives';

/**
 * Route comparison and decision explanation.
 *
 * Shows the alternatives that were considered alongside the one chosen, with
 * SMART-ER's reasoning in full. This is the panel that makes the routing
 * defensible: it is where a controller can see that the 6.0 km route was
 * chosen over the 5.2 km route because it arrives 85 seconds sooner, and that
 * distance was never the objective.
 */
export function RouteComparison({ route }: { route: Route }) {
  const chosen = route.alternatives[0];
  const others = route.alternatives.slice(1);

  const sourceLabel: Record<string, string> = {
    [RouteSource.GRAPH]: 'SMART-ER network',
    [RouteSource.GOOGLE_ROUTES]: 'Google Routes',
    [RouteSource.GOOGLE_DIRECTIONS]: 'Google Directions',
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">Route selection</h4>
        <Badge className="border-line bg-surface-sunken text-ink-600">
          {sourceLabel[route.source] ?? route.source}
        </Badge>
      </div>

      {/* Selected */}
      <div className="rounded-lg border border-ok-200 bg-ok-50 px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ok-600">Selected</span>
          <span className="tnum font-mono text-[11px] text-ink-800">
            {formatDistance(route.distanceM)} · {formatEta(route.etaSeconds)}
          </span>
        </div>
        <p className="tnum mt-0.5 font-mono text-[10px] text-ink-600">{route.junctionIds.join(' → ')}</p>
        {chosen && chosen.conflictingJunctionIds.length > 0 && (
          <p className="mt-0.5 text-[10px] text-warn-600">
            Contends for {chosen.conflictingJunctionIds.join(', ')}
          </p>
        )}
      </div>

      {/* Rejected alternatives, with the delta that decided it. */}
      {others.map((candidate) => {
        const deltaEta = candidate.etaSeconds - route.etaSeconds;
        const deltaDistance = candidate.distanceM - route.distanceM;
        const shorterButSlower = deltaDistance < 0 && deltaEta > 0;

        return (
          <div key={candidate.id} className="rounded-lg border border-line bg-surface-muted px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-ink-500">
                {candidate.label}
              </span>
              <span className="tnum font-mono text-[11px] text-ink-600">
                {formatDistance(candidate.distanceM)} · {formatEta(candidate.etaSeconds)}
              </span>
            </div>
            {candidate.junctionIds.length > 0 && (
              <p className="tnum mt-0.5 font-mono text-[10px] text-ink-9000">{candidate.junctionIds.join(' → ')}</p>
            )}
            <p className="mt-0.5 text-[10px]">
              <span className={deltaEta > 0 ? 'text-warn-600' : 'text-ok-600'}>
                {deltaEta >= 0 ? '+' : ''}
                {Math.round(deltaEta)} s
              </span>
              <span className="text-ink-9000">
                {' · '}
                {deltaDistance >= 0 ? '+' : ''}
                {formatDistance(Math.abs(deltaDistance))}
                {deltaDistance < 0 ? ' shorter' : ' longer'}
              </span>
              {shorterButSlower && (
                <span className="ml-1 text-ink-500">— shorter but slower; response time is the objective</span>
              )}
              {candidate.conflictingJunctionIds.length > 0 && (
                <span className="ml-1 text-critical-600">
                  · contends for {candidate.conflictingJunctionIds.join(', ')}
                </span>
              )}
            </p>
          </div>
        );
      })}

      {/* The reasoning, verbatim from the routing service. */}
      <div className="rounded-lg border border-line bg-surface px-2 py-1.5">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">Why this route</p>
        <p className="text-[11px] leading-relaxed text-ink-700">{route.explanation}</p>
      </div>
    </div>
  );
}
