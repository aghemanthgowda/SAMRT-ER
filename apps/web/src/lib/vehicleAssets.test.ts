import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VehicleKind } from '@smart-er/core';
import { vehicleAssetLabel, vehicleAssetUrl } from './vehicleAssets';

/**
 * The artwork is referenced by path, not imported, so nothing at build time
 * would notice a missing or renamed file — the first sign would be a broken
 * image on a control-room screen. These tests are that check.
 */
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

describe('vehicle assets', () => {
  const kinds = [VehicleKind.AMBULANCE, VehicleKind.FIRE_TRUCK, VehicleKind.POLICE_UNIT];

  it('maps every vehicle kind to a distinct asset', () => {
    const urls = kinds.map(vehicleAssetUrl);
    expect(new Set(urls).size).toBe(kinds.length);
    expect(urls).toEqual([
      '/assets/vehicles/ambulance.png',
      '/assets/vehicles/fire-truck.png',
      '/assets/vehicles/police-car.png',
    ]);
  });

  it.each(kinds)('ships a real PNG for %s', (kind) => {
    const file = path.join(PUBLIC_DIR, vehicleAssetUrl(kind));
    expect(fs.existsSync(file)).toBe(true);

    const bytes = fs.readFileSync(file);
    // PNG magic number: an asset replaced with a JPEG or an SVG would still
    // exist, and would still be the wrong thing at the path the code expects.
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('gives every kind a spoken label for screen readers', () => {
    for (const kind of kinds) {
      expect(vehicleAssetLabel(kind)).toMatch(/\w{4,}/);
    }
  });
});
