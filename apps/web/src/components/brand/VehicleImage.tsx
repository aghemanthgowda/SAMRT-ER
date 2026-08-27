import type { VehicleKind } from '@smart-er/core';
import { getVehicleImage, getVehicleLabel } from '@/lib/vehicleAssets';

/**
 * A vehicle, as it appears wherever a unit is listed.
 *
 * `object-contain` inside a fixed box: every unit takes the same footprint in a
 * list however wide its own artwork is, and a stretched ambulance stops reading
 * as an ambulance.
 */
export function VehicleImage({ kind, className = 'vehicle-icon' }: { kind: VehicleKind; className?: string }) {
  return <img src={getVehicleImage(kind)} alt={getVehicleLabel(kind)} className={className} loading="lazy" />;
}
