import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VehicleKind } from '@smart-er/core';
import {
  VEHICLE_ARTWORK_PATHS,
  getVehicleAspect,
  getVehicleImage,
  getVehicleLabel,
  getVehicleMapMarker,
} from './vehicleAssets';

/**
 * The artwork is referenced by path, not imported, so nothing at build time
 * would notice a missing or renamed file — the first sign would be a broken
 * image on a control-room screen. These tests are that check.
 */
const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const KINDS = [VehicleKind.AMBULANCE, VehicleKind.FIRE_TRUCK, VehicleKind.POLICE_UNIT];

function read(assetPath: string): Buffer {
  return fs.readFileSync(path.join(PUBLIC_DIR, assetPath));
}

describe('vehicle artwork', () => {
  it.each(VEHICLE_ARTWORK_PATHS)('%s exists and is a PNG', (assetPath) => {
    const file = path.join(PUBLIC_DIR, assetPath);
    expect(fs.existsSync(file)).toBe(true);

    // An asset swapped for a JPEG or an SVG would still exist, and would still
    // be the wrong thing at the path the code expects.
    expect(read(assetPath).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('gives every kind a distinct card image and a distinct pin', () => {
    const images = KINDS.map(getVehicleImage);
    const pins = KINDS.map(getVehicleMapMarker);

    expect(new Set(images).size).toBe(KINDS.length);
    expect(new Set(pins).size).toBe(KINDS.length);
  });

  it('never uses a card image as a map marker', () => {
    // A side-view vehicle does not read as a marker at map scale, and it does
    // not point at anything. The two sets must stay disjoint.
    const images = new Set(KINDS.map(getVehicleImage));
    for (const kind of KINDS) {
      expect(images.has(getVehicleMapMarker(kind))).toBe(false);
    }
  });

  it('carries a truthful aspect for each card image', () => {
    for (const kind of KINDS) {
      expect(getVehicleAspect(kind)).toBeGreaterThan(1);
      expect(getVehicleAspect(kind)).toBeLessThan(4);
    }
  });

  it('gives every kind a spoken label for screen readers', () => {
    for (const kind of KINDS) {
      expect(getVehicleLabel(kind)).toMatch(/\w{4,}/);
    }
  });

  it('ships no watermarked stock artwork', () => {
    // The supplied pin files were watermarked previews. These are composed from
    // the licensed vehicle artwork instead; a stock comp swapped back in would
    // be far larger than a flat two-colour teardrop.
    for (const assetPath of VEHICLE_ARTWORK_PATHS.filter((p) => p.includes('-pin'))) {
      expect(read(assetPath).length).toBeLessThan(60_000);
    }
  });
});
