import { useNavigate } from 'react-router-dom';
import { Activity, Gauge, Route, TrafficCone } from 'lucide-react';
import type { DashboardHeadline } from '@/api/client';

/**
 * The four headline figures.
 *
 * Every value is passed in from the API — none is computed in the component
 * and none is a constant. "View all" navigates to the page that shows the
 * detail behind the number, so a figure is never a dead end.
 */
export function StatCards({ headline, loading }: { headline?: DashboardHeadline; loading: boolean }) {
  const navigate = useNavigate();

  const cards = [
    {
      label: 'Active emergencies',
      value: headline?.activeEmergencies,
      icon: Activity,
      tone: 'bg-info-50 text-info-600',
      to: '/controller/vehicles',
    },
    {
      label: 'Active corridors',
      value: headline?.activeCorridors,
      icon: Route,
      tone: 'bg-ok-50 text-ok-600',
      to: '/controller/map',
    },
    {
      label: 'Junctions online',
      value: headline?.junctionsOnline,
      suffix: headline ? `/ ${headline.junctionsTotal}` : undefined,
      icon: TrafficCone,
      tone: 'bg-violet-50 text-violet-600',
      to: '/controller/junctions',
    },
    {
      label: 'Avg. response improvement',
      value: headline?.averageImprovementPercent,
      suffix: '%',
      icon: Gauge,
      tone: 'bg-warn-50 text-warn-600',
      to: '/controller/reports',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="card p-4">
            <div className="flex items-start gap-3">
              <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${card.tone}`}>
                <Icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-ink-500">{card.label}</p>
                <p className="tnum mt-0.5 font-mono text-[26px] font-semibold leading-none text-ink-900">
                  {loading || card.value === undefined ? (
                    <span className="inline-block h-[26px] w-12 animate-pulse rounded bg-surface-sunken align-middle" />
                  ) : (
                    <>
                      {card.value}
                      {card.suffix && (
                        <span className="ml-1 text-[15px] font-normal text-ink-400">{card.suffix}</span>
                      )}
                    </>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => navigate(card.to)}
                  className="mt-1.5 text-[12px] font-medium text-brand-600 transition-colors hover:text-brand-700"
                >
                  View all
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
