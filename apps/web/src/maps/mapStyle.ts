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
  { elementType: 'geometry', stylers: [{ color: '#182430' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7d90a6' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f1720' }, { weight: 2 }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },

  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#37475a' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },

  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },

  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#16212c' }] },
  { featureType: 'park', elementType: 'geometry', stylers: [{ color: '#152a24' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1b2a' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3f5468' }] },

  // Roads stay visible but quiet; the corridor overlay is what should stand out.
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#26333f' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#6b8098' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#2c3a47' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#35485a' }] },
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#222d38' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
];

/** Central Bengaluru — the area the seeded junction network covers. */
export const DEFAULT_CENTER = { lat: 12.9718, lng: 77.6035 };
export const DEFAULT_ZOOM = 14;
