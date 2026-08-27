/**
 * Google Maps styling for the operations console.
 *
 * The map is a background, not the subject. Base geography is pushed down to
 * a dark, low-contrast substrate so SMART-ER's own overlay — routes, corridors,
 * junctions, vehicles — reads clearly on top of it. Points of interest and
 * transit are removed entirely: they carry no operational meaning and every
 * label competes with a junction code.
 *
 * Applied only when no Map ID is configured; with a Map ID, styling is managed
 * in the Google Cloud console instead.
 */
export const OPERATIONS_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f4f6f9' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#667085' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 2.5 }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },

  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#dfe5ee' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },

  // Points of interest carry no operational meaning and every label competes
  // with a junction code, so they are removed rather than dimmed.
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },

  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#eef1f6' }] },
  { featureType: 'park', elementType: 'geometry', stylers: [{ color: '#e3f0e6' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d6e5f5' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#8aa2bd' }] },

  // Roads stay legible but quiet; the corridor overlay is what should stand out.
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e6eaf1' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a94a6' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#fdf3e3' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#f2e2c6' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
];

/** Central Bengaluru — the area the seeded junction network covers. */
export const DEFAULT_CENTER = { lat: 12.9718, lng: 77.6035 };
export const DEFAULT_ZOOM = 14;
