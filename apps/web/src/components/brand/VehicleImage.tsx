import type { VehicleKind } from '@smart-er/core';
import { vehicleAssetLabel, vehicleAssetUrl } from '@/lib/vehicleAssets';

/**
 * A vehicle, as it appears in every list and panel.
 *
 * The same asset the map draws, so a unit looks like itself wherever it is
 * shown — an operator glancing between the map and the emergency list should
 * not have to translate between a picture in one and an abstract mark in the
 * other. `object-contain` rather than `cover`, because a stretched ambulance
 * stops reading as an ambulance.
 */
export function VehicleImage({ kind, className = 'vehicle-icon' }: { kind: VehicleKind; className?: string }) {
  return <img src={vehicleAssetUrl(kind)} alt={vehicleAssetLabel(kind)} className={className} />;
}
