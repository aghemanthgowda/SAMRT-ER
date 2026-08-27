import type { VehicleKind } from '@smart-er/core';

/**
 * Side-view artwork for each class of emergency vehicle.
 *
 * One source of truth, held as markup rather than as a component, because it
 * has to be painted two different ways: inlined into the schematic map's SVG,
 * and encoded as a data URI for a Google Maps marker. A React component could
 * not do the second without pulling a server renderer into the browser bundle.
 *
 * Drawn rather than set in emoji: 🚑 renders as a different picture on every
 * platform, at a size the page cannot control, in colours that cannot be made
 * to carry state. These are flat, high-contrast and legible at 30px, which is
 * the size they are actually used at.
 */

export const GLYPH_WIDTH = 48;
export const GLYPH_HEIGHT = 30;

const WHEELS = (front: number, rear: number) => `
  <circle cx="${rear}" cy="22" r="4.2" fill="#1d2939"/>
  <circle cx="${rear}" cy="22" r="1.7" fill="#c3cad5"/>
  <circle cx="${front}" cy="22" r="4.2" fill="#1d2939"/>
  <circle cx="${front}" cy="22" r="1.7" fill="#c3cad5"/>
`;

/** A blue-and-red light bar, as sits on the roof of all three. */
const LIGHT_BAR = (x: number, y: number, width: number) => `
  <rect x="${x}" y="${y}" width="${width / 2}" height="3.4" rx="1.7" fill="#2563eb"/>
  <rect x="${x + width / 2}" y="${y}" width="${width / 2}" height="3.4" rx="1.7" fill="#dc2626"/>
`;

const AMBULANCE = `
  ${LIGHT_BAR(11, 2.6, 12)}
  <path d="M4 8.4h24v13.1H4z" fill="#ffffff"/>
  <path d="M28 8.4h6.6l6.2 5.6v7.5H28z" fill="#ffffff"/>
  <path d="M4 8.4h24v13.1H4zM28 8.4h6.6l6.2 5.6v7.5H28z"
        fill="none" stroke="#667085" stroke-width="1.3" stroke-linejoin="round"/>
  <path d="M29.6 9.9h4.4l4.3 3.9h-8.7z" fill="#cfe0f5"/>
  <rect x="4" y="17.4" width="24" height="2.6" fill="#dc2626"/>
  <rect x="14.6" y="9.6" width="3" height="6.4" fill="#dc2626"/>
  <rect x="12.9" y="11.3" width="6.4" height="3" fill="#dc2626"/>
  ${WHEELS(34, 12)}
`;

const FIRE_TRUCK = `
  ${LIGHT_BAR(9, 2.4, 13)}
  <rect x="4.5" y="6.2" width="21" height="2.2" rx="1.1" fill="#98a2b3"/>
  <path d="M3 8.8h26v12.7H3z" fill="#dc2626"/>
  <path d="M29 8.8h6l5.8 5.2v7.5H29z" fill="#dc2626"/>
  <path d="M3 8.8h26v12.7H3zM29 8.8h6l5.8 5.2v7.5H29z"
        fill="none" stroke="#991b1b" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M30.4 10.2h3.9l3.9 3.5h-7.8z" fill="#cfe0f5"/>
  <rect x="3" y="15.4" width="26" height="2" fill="#ffffff" opacity="0.9"/>
  <rect x="7" y="17.8" width="5.5" height="3.2" rx="0.6" fill="#f8fafc" opacity="0.55"/>
  <rect x="14.5" y="17.8" width="5.5" height="3.2" rx="0.6" fill="#f8fafc" opacity="0.55"/>
  ${WHEELS(34.5, 11)}
`;

const POLICE_UNIT = `
  ${LIGHT_BAR(16, 3.4, 12)}
  <path d="M5 21.5v-4.4l4.2-1.1 5-5.1h12.6l4.4 5.1 5.8 1.1v4.4z" fill="#ffffff"/>
  <path d="M5 21.5v-4.4l4.2-1.1 5-5.1h12.6l4.4 5.1 5.8 1.1v4.4z"
        fill="none" stroke="#667085" stroke-width="1.3" stroke-linejoin="round"/>
  <path d="M15.4 12h4.6v3.9h-8z" fill="#cfe0f5"/>
  <path d="M21.4 12h4.6l3.4 3.9h-8z" fill="#cfe0f5"/>
  <path d="M9.4 17.2h11.2v4.3H9.4z" fill="#2563eb"/>
  ${WHEELS(31, 13)}
`;

const GLYPHS: Record<VehicleKind, string> = {
  AMBULANCE,
  FIRE_TRUCK,
  POLICE_UNIT,
};

/** Inner SVG markup for a vehicle, in a 48x30 coordinate space. */
export function vehicleGlyph(kind: VehicleKind): string {
  return GLYPHS[kind];
}

/**
 * A complete standalone SVG for a vehicle.
 *
 * `haloColor` draws a soft plate behind the artwork so it stays readable over
 * a busy map, and carries the unit's corridor state — the same job the ring on
 * the old dot did, without giving up the picture.
 */
export function vehicleGlyphSvg(
  kind: VehicleKind,
  options: { haloColor?: string; selected?: boolean; dimmed?: boolean } = {},
): string {
  const { haloColor, selected = false, dimmed = false } = options;
  const halo = haloColor
    ? `<rect x="1" y="1.5" width="${GLYPH_WIDTH - 2}" height="${GLYPH_HEIGHT - 3}" rx="7"
             fill="#ffffff" opacity="0.82" stroke="${haloColor}" stroke-width="${selected ? 2.4 : 1.4}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${GLYPH_WIDTH}" height="${GLYPH_HEIGHT}"
               viewBox="0 0 ${GLYPH_WIDTH} ${GLYPH_HEIGHT}" opacity="${dimmed ? 0.45 : 1}">
            ${halo}${GLYPHS[kind]}
          </svg>`;
}
