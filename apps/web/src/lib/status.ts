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
    chip: 'bg-status-critical-dim text-status-critical border-status-critical/40',
    hex: '#e5484d',
    label: 'Critical',
  },
  [Severity.HIGH]: {
    chip: 'bg-status-high-dim text-status-high border-status-high/40',
    hex: '#f5a524',
    label: 'High',
  },
  [Severity.MEDIUM]: {
    chip: 'bg-status-medium-dim text-status-medium border-status-medium/40',
    hex: '#3d8bfd',
    label: 'Medium',
  },
  [Severity.LOW]: {
    chip: 'bg-ground-800 text-ground-300 border-ground-600',
    hex: '#7c8da3',
    label: 'Low',
  },
};

export const VEHICLE_STATUS_STYLE: Record<VehicleStatus, StatusStyle> = {
  [VehicleStatus.OFFLINE]: { chip: 'bg-ground-850 text-ground-400 border-ground-700', hex: '#6b8098', label: 'Offline' },
  [VehicleStatus.STANDBY]: { chip: 'bg-ground-800 text-ground-200 border-ground-600', hex: '#93a6bb', label: 'Standby' },
  [VehicleStatus.REQUESTED]: {
    chip: 'bg-status-high-dim text-status-high border-status-high/40',
    hex: '#f5a524',
    label: 'Requested',
  },
  [VehicleStatus.ACTIVE]: {
    chip: 'bg-status-ok-dim text-status-ok border-status-ok/40',
    hex: '#30a46c',
    label: 'Active',
  },
  [VehicleStatus.REROUTING]: {
    chip: 'bg-status-medium-dim text-status-medium border-status-medium/40',
    hex: '#3d8bfd',
    label: 'Rerouting',
  },
  [VehicleStatus.ARRIVED]: {
    chip: 'bg-status-ok-dim text-status-ok border-status-ok/40',
    hex: '#30a46c',
    label: 'Arrived',
  },
  [VehicleStatus.COMPLETED]: { chip: 'bg-ground-800 text-ground-300 border-ground-600', hex: '#93a6bb', label: 'Completed' },
};

export const REQUEST_STATUS_STYLE: Record<RequestStatus, StatusStyle> = {
  [RequestStatus.PENDING]: {
    chip: 'bg-status-high-dim text-status-high border-status-high/40',
    hex: '#f5a524',
    label: 'Pending',
  },
  [RequestStatus.APPROVED]: {
    chip: 'bg-status-ok-dim text-status-ok border-status-ok/40',
    hex: '#30a46c',
    label: 'Approved',
  },
  [RequestStatus.REJECTED]: {
    chip: 'bg-status-critical-dim text-status-critical border-status-critical/40',
    hex: '#e5484d',
    label: 'Rejected',
  },
  [RequestStatus.CANCELLED]: { chip: 'bg-ground-800 text-ground-300 border-ground-600', hex: '#7c8da3', label: 'Cancelled' },
  [RequestStatus.COMPLETED]: { chip: 'bg-ground-800 text-ground-200 border-ground-600', hex: '#93a6bb', label: 'Completed' },
};

export const JUNCTION_STATE_STYLE: Record<JunctionState, StatusStyle> = {
  [JunctionState.NORMAL]: { chip: 'bg-ground-800 text-ground-300 border-ground-600', hex: '#4d6076', label: 'Normal' },
  [JunctionState.PREPARING]: {
    chip: 'bg-status-high-dim text-status-high border-status-high/40',
    hex: '#f5a524',
    label: 'Preparing',
  },
  [JunctionState.GREEN]: {
    chip: 'bg-status-ok-dim text-status-ok border-status-ok/40',
    hex: '#30a46c',
    label: 'Green',
  },
  [JunctionState.RELEASED]: { chip: 'bg-ground-800 text-ground-300 border-ground-600', hex: '#6b8098', label: 'Released' },
  [JunctionState.CONFLICT]: {
    chip: 'bg-status-critical-dim text-status-critical border-status-critical/40',
    hex: '#e5484d',
    label: 'Conflict',
  },
  [JunctionState.OFFLINE]: {
    chip: 'bg-violet-500/15 text-violet-300 border-violet-500/40',
    hex: '#8b5cf6',
    label: 'Offline',
  },
};

export const DEVICE_STATUS_STYLE: Record<DeviceStatus, StatusStyle> = {
  [DeviceStatus.ONLINE]: {
    chip: 'bg-status-ok-dim text-status-ok border-status-ok/40',
    hex: '#30a46c',
    label: 'Online',
  },
  [DeviceStatus.DEGRADED]: {
    chip: 'bg-status-high-dim text-status-high border-status-high/40',
    hex: '#f5a524',
    label: 'Degraded',
  },
  [DeviceStatus.OFFLINE]: {
    chip: 'bg-status-critical-dim text-status-critical border-status-critical/40',
    hex: '#e5484d',
    label: 'Offline',
  },
};

export const TRAFFIC_STYLE: Record<TrafficLevel, StatusStyle> = {
  [TrafficLevel.FREE_FLOW]: { chip: 'bg-status-ok-dim text-status-ok border-status-ok/40', hex: '#30a46c', label: 'Free flow' },
  [TrafficLevel.NORMAL]: { chip: 'bg-ground-800 text-ground-200 border-ground-600', hex: '#59b37f', label: 'Normal' },
  [TrafficLevel.SLOW]: { chip: 'bg-status-high-dim text-status-high border-status-high/40', hex: '#f5a524', label: 'Slow' },
  [TrafficLevel.HEAVY]: {
    chip: 'bg-status-critical-dim text-status-critical border-status-critical/40',
    hex: '#e5484d',
    label: 'Heavy',
  },
  [TrafficLevel.BLOCKED]: { chip: 'bg-ground-800 text-ground-400 border-ground-600', hex: '#5b2126', label: 'Closed' },
};

export const IMPACT_STYLE: Record<ImpactLevel, StatusStyle> = {
  [ImpactLevel.NONE]: { chip: 'bg-ground-800 text-ground-300 border-ground-600', hex: '#6b8098', label: 'None' },
  [ImpactLevel.LOW]: { chip: 'bg-status-ok-dim text-status-ok border-status-ok/40', hex: '#30a46c', label: 'Low' },
  [ImpactLevel.MODERATE]: {
    chip: 'bg-status-high-dim text-status-high border-status-high/40',
    hex: '#f5a524',
    label: 'Moderate',
  },
  [ImpactLevel.HIGH]: {
    chip: 'bg-status-critical-dim text-status-critical border-status-critical/40',
    hex: '#e5484d',
    label: 'High',
  },
};

export const CORRIDOR_STATUS_STYLE: Record<CorridorStatus, StatusStyle> = {
  [CorridorStatus.PENDING]: { chip: 'bg-ground-800 text-ground-300 border-ground-600', hex: '#93a6bb', label: 'Pending' },
  [CorridorStatus.ACTIVE]: { chip: 'bg-status-ok-dim text-status-ok border-status-ok/40', hex: '#30a46c', label: 'Active' },
  [CorridorStatus.SUSPENDED]: {
    chip: 'bg-status-high-dim text-status-high border-status-high/40',
    hex: '#f5a524',
    label: 'Suspended',
  },
  [CorridorStatus.RELEASED]: { chip: 'bg-ground-800 text-ground-400 border-ground-700', hex: '#6b8098', label: 'Released' },
};

export const CONFLICT_STATUS_STYLE: Record<ConflictStatus, StatusStyle> = {
  [ConflictStatus.DETECTED]: {
    chip: 'bg-status-critical-dim text-status-critical border-status-critical/40',
    hex: '#e5484d',
    label: 'Detected',
  },
  [ConflictStatus.RESOLVED_REROUTE]: {
    chip: 'bg-status-ok-dim text-status-ok border-status-ok/40',
    hex: '#30a46c',
    label: 'Rerouted',
  },
  [ConflictStatus.RESOLVED_TIME_SLOT]: {
    chip: 'bg-status-medium-dim text-status-medium border-status-medium/40',
    hex: '#3d8bfd',
    label: 'Time-slotted',
  },
  [ConflictStatus.RESOLVED_PRIORITY_HOLD]: {
    chip: 'bg-status-high-dim text-status-high border-status-high/40',
    hex: '#f5a524',
    label: 'Held',
  },
  [ConflictStatus.UNRESOLVED]: {
    chip: 'bg-status-critical-dim text-status-critical border-status-critical/40',
    hex: '#e5484d',
    label: 'Unresolved',
  },
};

/** Colour a vehicle marker by type, so units are distinguishable on the map. */
export const VEHICLE_KIND_COLOR: Record<VehicleKind, string> = {
  [VehicleKind.AMBULANCE]: '#e5484d',
  [VehicleKind.FIRE_TRUCK]: '#f5701f',
  [VehicleKind.POLICE_UNIT]: '#3d8bfd',
};

export const VEHICLE_KIND_LABEL: Record<VehicleKind, string> = {
  [VehicleKind.AMBULANCE]: 'Ambulance',
  [VehicleKind.FIRE_TRUCK]: 'Fire appliance',
  [VehicleKind.POLICE_UNIT]: 'Police unit',
};
