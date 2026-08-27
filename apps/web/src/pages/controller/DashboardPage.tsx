import { useNavigate } from 'react-router-dom';
import { Card, CardLink } from '@/components/ui/primitives';
import { ActiveEmergencies } from '@/components/dashboard/ActiveEmergencies';
import { RecentAlerts } from '@/components/dashboard/RecentAlerts';
import { RequestQueuePanel } from '@/components/dashboard/RequestQueuePanel';
import { ResponseChart } from '@/components/dashboard/ResponseChart';
import { StatCards } from '@/components/dashboard/StatCards';
import { SystemStatusPanel } from '@/components/dashboard/SystemStatusPanel';
import { ControllerLayout } from '@/components/shell/ControllerLayout';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useVehicleIndex } from '@/hooks/useVehicleIndex';
import { OperationsMap } from '@/maps/OperationsMap';

/**
 * The controller dashboard.
 *
 * Layout, top to bottom: four headline figures, then the map — given the most
 * space, because geography is the only view that answers "where is everything
 * right now" — with active units beside it, then the operational panels.
 *
 * Nothing on this page holds its own copy of the truth. Counters and health
 * come from the API, units and requests from the realtime store, and the map
 * from the same store, so no two panels can disagree.
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const { vehicleById } = useVehicleIndex();
  const { headline, systemStatus, responseHistory, alerts, loading, error } = useDashboardData(7);

  return (
    <ControllerLayout title="Dashboard" subtitle="Central Bengaluru — traffic control">
      <div className="space-y-3">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-warn-200 bg-warn-50 px-3.5 py-2.5 text-[12.5px] text-warn-700"
          >
            Live operational data is showing, but summary figures could not be refreshed: {error}
          </div>
        )}

        <StatCards headline={headline} loading={loading} />

        {/* Map and active units */}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
          <Card
            title="Live traffic map"
            actions={<CardLink onClick={() => navigate('/controller/map')}>Open full map</CardLink>}
            className="min-h-[420px] xl:min-h-[520px]"
            bodyClassName="relative overflow-hidden rounded-b-xl"
            noPadding
          >
            <OperationsMap vehicleById={vehicleById} className="absolute inset-0" />
          </Card>

          <div className="min-h-[320px] xl:max-h-[520px]">
            <ActiveEmergencies vehicleById={vehicleById} />
          </div>
        </div>

        {/* Operational panels */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Card
            title="Request queue"
            actions={<CardLink onClick={() => navigate('/controller/requests')}>View all</CardLink>}
            className="max-h-[360px]"
            noPadding
          >
            <RequestQueuePanel vehicleById={vehicleById} compact />
          </Card>

          <Card
            title="Recent alerts"
            actions={<CardLink onClick={() => navigate('/controller/alerts')}>View all</CardLink>}
            className="max-h-[360px]"
            noPadding
          >
            <RecentAlerts alerts={alerts.slice(0, 6)} loading={loading} />
          </Card>

          <Card title="System status" className="max-h-[360px]" noPadding>
            <SystemStatusPanel statuses={systemStatus} loading={loading} />
          </Card>

          <Card
            title="Response improvement"
            actions={<span className="text-[12px] text-ink-500">7 days</span>}
            className="max-h-[360px]"
            noPadding
          >
            <ResponseChart samples={responseHistory} loading={loading} />
          </Card>
        </div>
      </div>
    </ControllerLayout>
  );
}
