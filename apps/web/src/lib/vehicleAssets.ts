import type { VehicleKind } from '@smart-er/core';

/**
 * Vehicle artwork.
 *
 * Two images per class, because they are shown at two very different sizes for
 * two different jobs. The card image is the vehicle itself, on transparency,
 * used wherever a unit is listed. The pin is a map marker: the same vehicle
 * inside a teardrop in the unit's colour, which reads at 40px over a busy map
 * where a bare side view would not.
 *
 * Served from `public/` rather than imported, so one path works in the browser,
 * in a Google Maps marker (which takes a URL, not a module) and inside the
 * schematic map's SVG.
 */

interface VehicleArtwork {
  /** The vehicle on transparency, for cards, lists and detail panels. */
  image: string;
  /** A map marker: the vehicle in a coloured teardrop. */
  pin: string;
  label: string;
  /** Natural aspect of `image`, so nothing has to be measured to avoid stretch. */
  aspect: number;
}

const ARTWORK: Record<VehicleKind, VehicleArtwork> = {
  AMBULANCE: {
    image: '/assets/vehicles/ambulance.png',
    pin: '/assets/vehicles/ambulance-pin.png',
    label: 'Ambulance',
    aspect: 360 / 178,
  },
  FIRE_TRUCK: {
    image: '/assets/vehicles/fire-engine.png',
    pin: '/assets/vehicles/fire-engine-pin.png',
    label: 'Fire engine',
    aspect: 360 / 211,
  },
  POLICE_UNIT: {
    image: '/assets/vehicles/police-car.png',
    pin: '/assets/vehicles/police-car-pin.png',
    label: 'Police unit',
    aspect: 360 / 145,
  },
};

/** The vehicle as shown in a card, list row or detail panel. */
export function getVehicleImage(kind: VehicleKind): string {
  return ARTWORK[kind].image;
}

/** The vehicle as shown on a map. Deliberately not the card image. */
export function getVehicleMapMarker(kind: VehicleKind): string {
  return ARTWORK[kind].pin;
}

export function getVehicleLabel(kind: VehicleKind): string {
  return ARTWORK[kind].label;
}

export function getVehicleAspect(kind: VehicleKind): number {
  return ARTWORK[kind].aspect;
}

/** Every artwork path, for the test that guards them against going missing. */
export const VEHICLE_ARTWORK_PATHS = Object.values(ARTWORK).flatMap((a) => [a.image, a.pin]);
