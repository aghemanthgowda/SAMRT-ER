import type { VehicleKind } from '@smart-er/core';

/**
 * Vehicle artwork, as static assets.
 *
 * Served from `public/` rather than imported, so the same paths work in the
 * browser, in a Google Maps marker (which takes a URL, not a module) and in
 * the schematic map's SVG. The PNGs are rasterised from the vector source in
 * `maps/vehicleGlyphs.ts`, which stays the thing to edit if the artwork needs
 * to change.
 */

const ASSET: Record<VehicleKind, string> = {
  AMBULANCE: '/assets/vehicles/ambulance.png',
  FIRE_TRUCK: '/assets/vehicles/fire-truck.png',
  POLICE_UNIT: '/assets/vehicles/police-car.png',
};

const LABEL: Record<VehicleKind, string> = {
  AMBULANCE: 'Ambulance',
  FIRE_TRUCK: 'Fire appliance',
  POLICE_UNIT: 'Police unit',
};

/** Natural aspect of the artwork, used to size map markers without stretching. */
export const VEHICLE_ASSET_ASPECT = 48 / 30;

export function vehicleAssetUrl(kind: VehicleKind): string {
  return ASSET[kind];
}

export function vehicleAssetLabel(kind: VehicleKind): string {
  return LABEL[kind];
}
