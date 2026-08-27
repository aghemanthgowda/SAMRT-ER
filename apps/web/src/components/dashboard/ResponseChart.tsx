import { useId } from 'react';
import type { ResponseSample } from '@smart-er/core';
import { Empty } from '@/components/ui/primitives';

/**
 * Response improvement over the selected window.
 *
 * Percentage improvement against the no-corridor baseline, computed server-side
 * from completed runs. Drawn as inline SVG rather than pulled in from a chart
 * library: it is one series with seven points, and a dependency to draw a
 * polyline is not worth the bundle.
 *
 * The y-axis is fixed at 0–100 % rather than scaled to the data. An autoscaled
 * axis would make a two-point wobble look like a cliff, which is exactly the
 * wrong impression for a figure people will quote.
 */
export function ResponseChart({ samples, loading }: { samples: ResponseSample[]; loading: boolean }) {
  const gradientId = useId();

  if (loading && samples.length === 0) {
    return <div className="m-4 h-[150px] animate-pulse rounded-lg bg-surface-sunken" />;
  }
  if (samples.length === 0) {
    return <Empty message="No response data yet" hint="Completed runs build this chart as the system operates." />;
  }

  const width = 320;
  const height = 140;
  const padding = { top: 10, right: 8, bottom: 20, left: 26 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const x = (index: number) =>
    padding.left + (samples.length === 1 ? plotW / 2 : (index / (samples.length - 1)) * plotW);
  const y = (percent: number) => padding.top + plotH - (Math.max(0, Math.min(100, percent)) / 100) * plotH;

  const points = samples.map((sample, index) => ({
    ...sample,
    cx: x(index),
    cy: y(sample.improvementPercent),
  }));

  /*
   * A day with no completed runs has no improvement figure — it is a gap, not
   * a zero. Plotting it as 0 % would draw a cliff on the chart and imply the
   * system performed badly, when in fact nothing ran. Only days with data are
   * joined, and the current day is almost always one of the gaps.
   */
  const plotted = points.filter((point) => point.completedRuns > 0);
  const line = plotted.map((point) => `${point.cx.toFixed(1)},${point.cy.toFixed(1)}`).join(' ');
  const area =
    plotted.length >= 2
      ? `${plotted[0]!.cx.toFixed(1)},${(padding.top + plotH).toFixed(1)} ${line} ${plotted[plotted.length - 1]!.cx.toFixed(1)},${(padding.top + plotH).toFixed(1)}`
      : '';

  const withRuns = samples.filter((sample) => sample.completedRuns > 0);
  const mean =
    withRuns.length > 0
      ? Math.round(withRuns.reduce((total, sample) => total + sample.improvementPercent, 0) / withRuns.length)
      : 0;
  const totalRuns = samples.reduce((total, sample) => total + sample.completedRuns, 0);

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="tnum font-mono text-[26px] font-semibold leading-none text-ink-900">{mean}%</span>
        <span className="text-[12px] text-ink-500">
          mean over {samples.length} days · {totalRuns} runs
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[140px] w-full"
        role="img"
        aria-label={`Response improvement: ${samples.map((s) => `${s.date} ${s.improvementPercent}%`).join(', ')}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gridlines at 0, 50 and 100 %. */}
        {[0, 50, 100].map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              y1={y(tick)}
              x2={width - padding.right}
              y2={y(tick)}
              stroke="#e3e8ef"
              strokeWidth={1}
            />
            <text x={padding.left - 6} y={y(tick) + 3.5} textAnchor="end" fontSize={9} fill="#98a2b3">
              {tick}
            </text>
          </g>
        ))}

        {area && <polygon points={area} fill={`url(#${gradientId})`} />}
        {plotted.length >= 2 && (
          <polyline
            points={line}
            fill="none"
            stroke="#2563eb"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {points.map((point) => (
          <g key={point.date}>
            {point.completedRuns > 0 ? (
              <circle
                cx={point.cx}
                cy={point.cy}
                r={3}
                fill="#ffffff"
                stroke="#2563eb"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${point.date}: ${point.improvementPercent}% over ${point.completedRuns} run(s)`}</title>
              </circle>
            ) : (
              // A hollow tick on the axis marks a day with no runs, so the gap
              // is visible rather than silently absent.
              <circle cx={point.cx} cy={padding.top + plotH} r={1.5} fill="#cdd5e0">
                <title>{`${point.date}: no completed runs`}</title>
              </circle>
            )}
            <text x={point.cx} y={height - 6} textAnchor="middle" fontSize={9} fill="#98a2b3">
              {point.date.slice(8)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
