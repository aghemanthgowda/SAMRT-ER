import { Card } from '@/components/ui/primitives';
import { ConflictMonitor } from '@/components/panels/ConflictMonitor';
import { DetailPanel } from '@/components/panels/DetailPanel';
import { IncidentQueue } from '@/components/panels/IncidentQueue';
import { IncidentTimeline } from '@/components/panels/IncidentTimeline';
import { ControllerLayout } from '@/components/shell/ControllerLayout';
import { useVehicleIndex } from '@/hooks/useVehicleIndex';
import { useOpsStore, useOpenIncidents } from '@/stores/opsStore';

/**
 * Incidents and junction contention.
 *
 * The conflict monitor sits here rather than on the dashboard because reading
 * a resolution properly takes more room than a summary card affords — and the
 * explanation is the point: a controller has to be able to justify the
 * decision afterwards.
 */
export function IncidentsPage() {
  const { vehicleById } = useVehicleIndex();
  const open = useOpenIncidents();
  const conflicts = useOpsStore((state) => Object.keys(state.conflicts).length);

  return (
    <ControllerLayout
      title="Incidents"
      subtitle={`${open.length} open · ${conflicts} junction conflict${conflicts === 1 ? '' : 's'} recorded`}
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="space-y-3">
          <Card title="Open incidents" className="max-h-[380px]" noPadding>
            <IncidentQueue />
          </Card>
          <Card title="Conflict monitor" className="max-h-[480px]" noPadding>
            <ConflictMonitor />
          </Card>
        </div>

        <div className="grid min-h-0 gap-3 xl:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card title="Detail" noPadding>
            <DetailPanel vehicleById={vehicleById} />
          </Card>
          <Card title="Event timeline" className="max-h-[420px]" noPadding>
            <IncidentTimeline />
          </Card>
        </div>
      </div>
    </ControllerLayout>
  );
}
