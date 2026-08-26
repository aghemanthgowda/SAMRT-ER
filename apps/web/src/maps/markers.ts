import type { VehicleKind } from '@smart-er/core';
import { VEHICLE_KIND_COLOR } from '@/lib/status';

/**
 * Map marker artwork, as inline SVG data URIs.
 *
 * Drawn rather than imported so the fill can carry status: an ambulance
 * marker is the ambulance colour, and its ring is the corridor state. Emoji
 * would be simpler but render differently on every platform and cannot encode
 * state, which is the whole job of these markers.
 */

function dataUri(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
}

const GLYPH: Record<VehicleKind, string> = {
  AMBULANCE:
    '<path d="M12 8.5v7M8.5 12h7" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
  FIRE_TRUCK:
    '<path d="M12 7.4c1.9 2.2 3.6 3.7 3.6 6a3.6 3.6 0 1 1-7.2 0c0-2.3 1.7-3.8 3.6-6z" fill="#fff"/>',
  POLICE_UNIT:
    '<path d="M12 7l4 1.8v3.1c0 2.4-1.6 4.4-4 5.1-2.4-.7-4-2.7-4-5.1V8.8L12 7z" fill="#fff"/>',
};

/**
 * A vehicle marker: a coloured disc with a type glyph and a heading pointer.
 * `ringColor` carries corridor state so a unit's status is legible without
 * opening its panel.
 */
export function vehicleMarkerIcon(kind: VehicleKind, heading: number, ringColor: string, dimmed = false): string {
  const fill = VEHICLE_KIND_COLOR[kind];
  const opacity = dimmed ? 0.45 : 1;
  return dataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" opacity="${opacity}">
      <g transform="translate(18 18)">
        <g transform="rotate(${Math.round(heading)})">
          <path d="M0 -15.5 L4.2 -9.5 L-4.2 -9.5 Z" fill="${ringColor}"/>
        </g>
        <circle r="11" fill="${ringColor}" opacity="0.9"/>
        <circle r="9" fill="${fill}"/>
        <g transform="translate(-12 -12)">${GLYPH[kind]}</g>
      </g>
    </svg>
  `);
}

/**
 * A junction marker. Size and ring weight track how strongly the junction is
 * involved: a held junction is larger and ringed, a normal one is a small dot.
 */
export function junctionMarkerIcon(code: string, color: string, held: boolean): string {
  const radius = held ? 12 : 8;
  const ring = held ? `<circle r="${radius + 3}" fill="none" stroke="${color}" stroke-width="2" opacity="0.55"/>` : '';
  return dataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
      <g transform="translate(17 17)">
        ${ring}
        <circle r="${radius}" fill="#0f1720" stroke="${color}" stroke-width="2"/>
        <text x="0" y="${held ? 4 : 3.4}" text-anchor="middle" font-family="Inter, system-ui, sans-serif"
              font-size="${held ? 10 : 8.5}" font-weight="700" fill="${color}">${code}</text>
      </g>
    </svg>
  `);
}

/** Facility marker — square, so it never reads as a vehicle or a junction. */
export function facilityMarkerIcon(kind: string): string {
  const palette: Record<string, string> = {
    HOSPITAL: '#e5484d',
    FIRE_STATION: '#f5701f',
    POLICE_HQ: '#3d8bfd',
    INCIDENT_SITE: '#f5a524',
  };
  const color = palette[kind] ?? '#7c8da3';
  const glyph: Record<string, string> = {
    HOSPITAL: '<path d="M11 6.5v9M6.5 11h9" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>',
    FIRE_STATION: '<path d="M11 6c1.7 2 3.2 3.3 3.2 5.3a3.2 3.2 0 1 1-6.4 0C7.8 9.3 9.3 8 11 6z" fill="#fff"/>',
    POLICE_HQ: '<path d="M11 6l3.5 1.6v2.7c0 2.1-1.4 3.9-3.5 4.5-2.1-.6-3.5-2.4-3.5-4.5V7.6L11 6z" fill="#fff"/>',
    INCIDENT_SITE: '<path d="M11 6.2l4.6 8.4H6.4L11 6.2z" fill="#fff"/>',
  };
  return dataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 22 22">
      <rect x="1" y="1" width="20" height="20" rx="3" fill="${color}" stroke="#0f1720" stroke-width="1.5"/>
      ${glyph[kind] ?? ''}
    </svg>
  `);
}

/** Conflict marker — a warning triangle, used only where routes contend. */
export function conflictMarkerIcon(): string {
  return dataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
      <path d="M15 4l12 21H3L15 4z" fill="#e5484d" stroke="#0f1720" stroke-width="1.6"/>
      <path d="M15 12v6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="15" cy="21.5" r="1.4" fill="#fff"/>
    </svg>
  `);
}
