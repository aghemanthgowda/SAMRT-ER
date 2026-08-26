import { describe, expect, it } from 'vitest';
import { JunctionState, Severity, VehicleStatus } from '@smart-er/core';
import {
  CONFLICT_STATUS_STYLE,
  DEVICE_STATUS_STYLE,
  IMPACT_STYLE,
  JUNCTION_STATE_STYLE,
  REQUEST_STATUS_STYLE,
  SEVERITY_STYLE,
  TRAFFIC_STYLE,
  VEHICLE_KIND_COLOR,
  VEHICLE_STATUS_STYLE,
} from './status';

/**
 * The status map is the contract between the map legend and every table in the
 * product. These tests exist to catch the failure mode where amber quietly
 * starts meaning two different things.
 */
describe('status styling', () => {
  const maps = {
    SEVERITY_STYLE,
    VEHICLE_STATUS_STYLE,
    REQUEST_STATUS_STYLE,
    JUNCTION_STATE_STYLE,
    DEVICE_STATUS_STYLE,
    TRAFFIC_STYLE,
    IMPACT_STYLE,
    CONFLICT_STATUS_STYLE,
  };

  it('gives every state a label and a valid hex colour', () => {
    for (const [name, map] of Object.entries(maps)) {
      for (const [key, style] of Object.entries(map)) {
        expect(style.label, `${name}.${key} has no label`).toBeTruthy();
        expect(style.hex, `${name}.${key} has an invalid hex`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(style.chip, `${name}.${key} has no chip classes`).toBeTruthy();
      }
    }
  });

  it('keeps the junction states visually distinct', () => {
    const hexes = Object.values(JUNCTION_STATE_STYLE).map((style) => style.hex.toLowerCase());
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it('keeps vehicle types visually distinct on the map', () => {
    const colors = Object.values(VEHICLE_KIND_COLOR).map((color) => color.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('uses the same colour for a concept wherever it appears', () => {
    // "Green" on a junction and "active" on a vehicle are both the ok colour.
    expect(JUNCTION_STATE_STYLE[JunctionState.GREEN].hex).toBe(VEHICLE_STATUS_STYLE[VehicleStatus.ACTIVE].hex);
    // "Preparing" and "requested" both mean "attention, not yet acted on".
    expect(JUNCTION_STATE_STYLE[JunctionState.PREPARING].hex).toBe(
      VEHICLE_STATUS_STYLE[VehicleStatus.REQUESTED].hex,
    );
    // Critical severity and a junction conflict are the same alarm colour.
    expect(SEVERITY_STYLE[Severity.CRITICAL].hex).toBe(JUNCTION_STATE_STYLE[JunctionState.CONFLICT].hex);
  });

  it('covers every enum member', () => {
    expect(Object.keys(SEVERITY_STYLE)).toHaveLength(4);
    expect(Object.keys(VEHICLE_STATUS_STYLE)).toHaveLength(7);
    expect(Object.keys(JUNCTION_STATE_STYLE)).toHaveLength(6);
  });
});
