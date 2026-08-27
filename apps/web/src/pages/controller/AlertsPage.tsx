import { Card } from '@/components/ui/primitives';
import { RecentAlerts } from '@/components/dashboard/RecentAlerts';
import { IncidentTimeline } from '@/components/panels/IncidentTimeline';
import { ControllerLayout } from '@/components/shell/ControllerLayout';
import { useDashboardData } from '@/hooks/useDashboardData';

/**
 * Alerts.
 *
 * The alert list is a filtered view of the incident timeline — the events a
 * controller would want pulled out of the stream. The full timeline sits
 * beside it, because "what else was happening at that moment" is the next
 * question after every alert.
 */
export function AlertsPage() {
  const { alerts, loading, error, refresh } = useDashboardData();

  return (
    <ControllerLayout title="Alerts" subtitle={`${alerts.length} recent operational alert${alerts.length === 1 ? '' : 's'}`}>
      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-warn-200 bg-warn-50 px-3.5 py-2.5 text-[12.5px] text-warn-700">
          Alerts could not be refreshed: {error}
          <button type="button" onClick={refresh} className="ml-2 font-medium underline">
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Operational alerts" className="max-h-[calc(100vh-180px)]" noPadding>
          <RecentAlerts alerts={alerts} loading={loading} />
        </Card>
        <Card title="Full event timeline" className="max-h-[calc(100vh-180px)]" noPadding>
          <IncidentTimeline />
        </Card>
      </div>
    </ControllerLayout>
  );
}
