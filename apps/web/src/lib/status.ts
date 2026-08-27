import {
  ConflictStatus,
  CorridorStatus,
  DeviceStatus,
  ImpactLevel,
  JunctionState,
  RequestStatus,
  Severity,
  TrafficLevel,
  VehicleKind,
  VehicleStatus,
} from '@smart-er/core';

/**
 * The single mapping from operational state to colour.
 *
 * Every badge, marker, polyline and legend entry reads from here. Defining it
 * once is what keeps the map legend honest: if amber means PREPARING on the
 * map, it must mean PREPARING in the junction table too, or the display stops
 * being readable at a glance.
 */

export interface StatusStyle {
  /** Tailwind classes for a pill or badge. */
  chip: string;
  /** Hex, for map overlays and SVG where Tailwind classes cannot reach. */
  hex: string;
  label: string;
}

export const SEVERITY_STYLE: Record<Severity, StatusStyle> = {
  [Severity.CRITICAL]: {
    chip: 'bg-critical-50 text-critical-700 border-critical-200',
    hex: '#ef4444',
    label: 'Critical',
  },
  [Severity.HIGH]: {
    chip: 'bg-warn-50 text-warn-700 border-warn-200',
    hex: '#f59e0b',
    label: 'High',
  },
  [Severity.MEDIUM]: {
    chip: 'bg-info-50 text-info-600 border-info-200',
    hex: '#3b82f6',
    label: 'Medium',
  },
  [Severity.LOW]: {
    chip: 'bg-surface-sunken text-ink-600 border-line',
    hex: '#667085',
    label: 'Low',
  },
};

export const VEHICLE_STATUS_STYLE: Record<VehicleStatus, StatusStyle> = {
  [VehicleStatus.OFFLINE]: { chip: 'bg-surface-sunken text-ink-500 border-line', hex: '#98a2b3', label: 'Offline' },
  [VehicleStatus.STANDBY]: { chip: 'bg-surface-sunken text-ink-700 border-line', hex: '#667085', label: 'Standby' },
  [VehicleStatus.REQUESTED]: {
    chip: 'bg-warn-50 text-warn-700 border-warn-200',
    hex: '#f59e0b',
    label: 'Requested',
  },
  [VehicleStatus.ACTIVE]: {
    chip: 'bg-ok-50 text-ok-700 border-ok-200',
    hex: '#12b76a',
    label: 'Active',
  },
  [VehicleStatus.REROUTING]: {
    chip: 'bg-info-50 text-info-600 border-info-200',
    hex: '#3b82f6',
    label: 'Rerouting',
  },
  [VehicleStatus.ARRIVED]: {
    chip: 'bg-ok-50 text-ok-700 border-ok-200',
    hex: '#12b76a',
    label: 'Arrived',
  },
  [VehicleStatus.COMPLETED]: { chip: 'bg-surface-sunken text-ink-600 border-line', hex: '#667085', label: 'Completed' },
};

export const REQUEST_STATUS_STYLE: Record<RequestStatus, StatusStyle> = {
  [RequestStatus.PENDING]: {
    chip: 'bg-warn-50 text-warn-700 border-warn-200',
    hex: '#f59e0b',
    label: 'Pending',
  },
  [RequestStatus.APPROVED]: {
    chip: 'bg-ok-50 text-ok-700 border-ok-200',
    hex: '#12b76a',
    label: 'Approved',
  },
  [RequestStatus.REJECTED]: {
    chip: 'bg-critical-50 text-critical-700 border-critical-200',
    hex: '#ef4444',
    label: 'Rejected',
  },
  [RequestStatus.CANCELLED]: { chip: 'bg-surface-sunken text-ink-600 border-line', hex: '#667085', label: 'Cancelled' },
  [RequestStatus.COMPLETED]: { chip: 'bg-surface-sunken text-ink-700 border-line', hex: '#667085', label: 'Completed' },
};

export const JUNCTION_STATE_STYLE: Record<JunctionState, StatusStyle> = {
  [JunctionState.NORMAL]: { chip: 'bg-surface-sunken text-ink-600 border-line', hex: '#667085', label: 'Normal' },
  [JunctionState.PREPARING]: {
    chip: 'bg-warn-50 text-warn-700 border-warn-200',
    hex: '#f59e0b',
    label: 'Preparing',
  },
  [JunctionState.GREEN]: {
    chip: 'bg-ok-50 text-ok-700 border-ok-200',
    hex: '#12b76a',
    label: 'Green',
  },
  [JunctionState.RELEASED]: { chip: 'bg-surface-sunken text-ink-600 border-line', hex: '#3b82f6', label: 'Released' },
  [JunctionState.CONFLICT]: {
    chip: 'bg-critical-50 text-critical-700 border-critical-200',
    hex: '#ef4444',
    label: 'Conflict',
  },
  [JunctionState.OFFLINE]: {
    chip: 'bg-violet-50 text-violet-600 border-violet-100',
    hex: '#8b5cf6',
    label: 'Offline',
  },
};

export const DEVICE_STATUS_STYLE: Record<DeviceStatus, StatusStyle> = {
  [DeviceStatus.ONLINE]: {
    chip: 'bg-ok-50 text-ok-700 border-ok-200',
    hex: '#12b76a',
    label: 'Online',
  },
  [DeviceStatus.DEGRADED]: {
    chip: 'bg-warn-50 text-warn-700 border-warn-200',
    hex: '#f59e0b',
    label: 'Degraded',
  },
  [DeviceStatus.OFFLINE]: {
    chip: 'bg-critical-50 text-critical-700 border-critical-200',
    hex: '#ef4444',
    label: 'Offline',
  },
};

/**
 * Traffic condition.
 *
 * Free-flowing and normal roads are deliberately neutral grey, not green.
 * Colouring every healthy road green would light up the entire network and
 * leave the one thing that matters — the active emergency corridor — with
 * nothing to stand out against. Colour here marks the exception: congestion,
 * and closure.
 */
export const TRAFFIC_STYLE: Record<TrafficLevel, StatusStyle> = {
  [TrafficLevel.FREE_FLOW]: { chip: 'bg-ok-50 text-ok-700 border-ok-200', hex: '#cdd5e0', label: 'Free flow' },
  [TrafficLevel.NORMAL]: { chip: 'bg-surface-sunken text-ink-700 border-line', hex: '#c3cad5', label: 'Normal' },
  [TrafficLevel.SLOW]: { chip: 'bg-warn-50 text-warn-700 border-warn-200', hex: '#f59e0b', label: 'Slow' },
  [TrafficLevel.HEAVY]: {
    chip: 'bg-critical-50 text-critical-700 border-critical-200',
    hex: '#ef4444',
    label: 'Heavy',
  },
  [TrafficLevel.BLOCKED]: { chip: 'bg-surface-sunken text-ink-500 border-line', hex: '#9f1239', label: 'Closed' },
};

export const IMPACT_STYLE: Record<ImpactLevel, StatusStyle> = {
  [ImpactLevel.NONE]: { chip: 'bg-surface-sunken text-ink-600 border-line', hex: '#98a2b3', label: 'None' },
  [ImpactLevel.LOW]: { chip: 'bg-ok-50 text-ok-700 border-ok-200', hex: '#12b76a', label: 'Low' },
  [ImpactLevel.MODERATE]: {
    chip: 'bg-warn-50 text-warn-700 border-warn-200',
    hex: '#f59e0b',
    label: 'Moderate',
  },
  [ImpactLevel.HIGH]: {
    chip: 'bg-critical-50 text-critical-700 border-critical-200',
    hex: '#ef4444',
    label: 'High',
  },
};

export const CORRIDOR_STATUS_STYLE: Record<CorridorStatus, StatusStyle> = {
  [CorridorStatus.PENDING]: { chip: 'bg-surface-sunken text-ink-600 border-line', hex: '#667085', label: 'Pending' },
  [CorridorStatus.ACTIVE]: { chip: 'bg-ok-50 text-ok-700 border-ok-200', hex: '#12b76a', label: 'Active' },
  [CorridorStatus.SUSPENDED]: {
    chip: 'bg-warn-50 text-warn-700 border-warn-200',
    hex: '#f59e0b',
    label: 'Suspended',
  },
  [CorridorStatus.RELEASED]: { chip: 'bg-surface-sunken text-ink-500 border-line', hex: '#3b82f6', label: 'Released' },
};

export const CONFLICT_STATUS_STYLE: Record<ConflictStatus, StatusStyle> = {
  [ConflictStatus.DETECTED]: {
    chip: 'bg-critical-50 text-critical-700 border-critical-200',
    hex: '#ef4444',
    label: 'Detected',
  },
  [ConflictStatus.RESOLVED_REROUTE]: {
    chip: 'bg-ok-50 text-ok-700 border-ok-200',
    hex: '#12b76a',
    label: 'Rerouted',
  },
  [ConflictStatus.RESOLVED_TIME_SLOT]: {
    chip: 'bg-info-50 text-info-600 border-info-200',
    hex: '#3b82f6',
    label: 'Time-slotted',
  },
  [ConflictStatus.RESOLVED_PRIORITY_HOLD]: {
    chip: 'bg-warn-50 text-warn-700 border-warn-200',
    hex: '#f59e0b',
    label: 'Held',
  },
  [ConflictStatus.UNRESOLVED]: {
    chip: 'bg-critical-50 text-critical-700 border-critical-200',
    hex: '#ef4444',
    label: 'Unresolved',
  },
};

/** Colour a vehicle marker by type, so units are distinguishable on the map. */
export const VEHICLE_KIND_COLOR: Record<VehicleKind, string> = {
  [VehicleKind.AMBULANCE]: '#ef4444',
  [VehicleKind.FIRE_TRUCK]: '#ea580c',
  [VehicleKind.POLICE_UNIT]: '#3b82f6',
};

export const VEHICLE_KIND_LABEL: Record<VehicleKind, string> = {
  [VehicleKind.AMBULANCE]: 'Ambulance',
  [VehicleKind.FIRE_TRUCK]: 'Fire appliance',
  [VehicleKind.POLICE_UNIT]: 'Police unit',
};
