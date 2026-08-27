import { useState } from 'react';
import { Card, Field } from '@/components/ui/primitives';
import { ResponseChart } from '@/components/dashboard/ResponseChart';
import { PublicImpact } from '@/components/panels/PublicImpact';
import { ControllerLayout } from '@/components/shell/ControllerLayout';
import { useDashboardData } from '@/hooks/useDashboardData';
import { formatEta } from '@smart-er/core';

/**
 * Reporting.
 *
 * Response improvement over a selectable window, and the public traffic cost
 * of achieving it. The two belong on one page: the benefit figure is only
 * meaningful next to what it cost everyone else.
 */
export function ReportsPage() {
  const [days, setDays] = useState(7);
  const { responseHistory, loading } = useDashboardData(days);

  const withRuns = responseHistory.filter((sample) => sample.completedRuns > 0);
  const totalRuns = responseHistory.reduce((total, sample) => total + sample.completedRuns, 0);
  const meanSaved =
    withRuns.length > 0
      ? Math.round(withRuns.reduce((total, sample) => total + sample.averageSecondsSaved, 0) / withRuns.length)
      : 0;
  const best = withRuns.reduce<(typeof withRuns)[number] | undefined>(
    (top, sample) => (!top || sample.improvementPercent > top.improvementPercent ? sample : top),
    undefined,
  );

  return (
    <ControllerLayout title="Reports" subtitle="Response performance and public traffic impact">
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card
            title="Response improvement"
            actions={
              <select
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
                aria-label="Reporting window"
                className="h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px] text-ink-700 outline-none focus:border-brand-500"
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </select>
            }
            noPadding
          >
            <ResponseChart samples={responseHistory} loading={loading} />
          </Card>

          <Card title="Summary">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Completed runs" value={String(totalRuns)} mono />
              <Field label="Mean time saved" value={formatEta(meanSaved)} mono />
              <Field
                label="Best day"
                value={best ? `${best.improvementPercent}%` : '—'}
                mono
              />
              <Field label="Days with runs" value={`${withRuns.length} / ${responseHistory.length}`} mono />
            </div>
            <p className="mt-4 text-[11.5px] leading-relaxed text-ink-500">
              Improvement is measured against the same journey with no corridor — every junction on the route
              contributing its ordinary delay. It is derived from completed runs, not asserted.
            </p>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card title="Public traffic impact" noPadding>
            <PublicImpact />
          </Card>

          <Card title="Daily detail" noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 text-right font-semibold">Runs</th>
                    <th className="px-3 py-2 text-right font-semibold">Improvement</th>
                    <th className="px-4 py-2 text-right font-semibold">Mean saved</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...responseHistory].reverse().map((sample) => (
                    <tr key={sample.date}>
                      <td className="tnum px-4 py-2 font-mono text-[12.5px] text-ink-700">{sample.date}</td>
                      <td className="tnum px-3 py-2 text-right font-mono text-[12.5px] text-ink-600">
                        {sample.completedRuns}
                      </td>
                      <td className="tnum px-3 py-2 text-right font-mono text-[12.5px] text-ink-900">
                        {sample.completedRuns > 0 ? `${sample.improvementPercent}%` : '—'}
                      </td>
                      <td className="tnum px-4 py-2 text-right font-mono text-[12.5px] text-ink-600">
                        {sample.completedRuns > 0 ? formatEta(sample.averageSecondsSaved) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </ControllerLayout>
  );
}
