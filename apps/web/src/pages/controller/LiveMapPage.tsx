import { Card } from '@/components/ui/primitives';
import { DetailPanel } from '@/components/panels/DetailPanel';
import { ActiveEmergencies } from '@/components/dashboard/ActiveEmergencies';
import { ControllerLayout } from '@/components/shell/ControllerLayout';
import { useVehicleIndex } from '@/hooks/useVehicleIndex';
import { OperationsMap } from '@/maps/OperationsMap';

/**
 * Full-bleed operational map.
 *
 * The dashboard's map is one card among several; this page is the map with
 * everything else subordinate to it — for the wall display, or for working a
 * complex multi-vehicle situation where the geography is the whole problem.
 */
export function LiveMapPage() {
  const { vehicleById } = useVehicleIndex();

  return (
    <ControllerLayout title="Live map" subtitle="All units, junctions and corridors" fill>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <Card className="min-h-[400px] xl:min-h-0" bodyClassName="relative overflow-hidden rounded-xl" noPadding>
          <OperationsMap vehicleById={vehicleById} className="absolute inset-0" />
        </Card>

        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <ActiveEmergencies vehicleById={vehicleById} />
          <Card title="Detail" noPadding>
            <DetailPanel vehicleById={vehicleById} />
          </Card>
        </div>
      </div>
    </ControllerLayout>
  );
}
