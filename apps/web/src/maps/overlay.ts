import type {
  Conflict,
  Corridor,
  Facility,
  Incident,
  Junction,
  JunctionRuntimeState,
  LatLng,
  Route,
  Vehicle,
  VehicleState,
} from '@smart-er/core';
import { JunctionState } from '@smart-er/core';
import { JUNCTION_STATE_STYLE, VEHICLE_KIND_COLOR } from '@/lib/status';
import { conflictMarkerIcon, facilityMarkerIcon, junctionMarkerIcon, vehicleMarkerIcon } from './markers';
import type { Selection } from '@/stores/opsStore';

/**
 * The SMART-ER overlay layer.
 *
 * Google Maps supplies the geography; everything operational is drawn on top
 * of it here — routes, corridors, junction states, vehicles, facilities,
 * incidents and conflicts.
 *
 * The layer diffs against what is already on the map rather than clearing and
 * redrawing. On a console updating once a second with a dozen units, tearing
 * down every overlay each tick makes markers visibly flicker and throws away
 * the click targets an operator may be reaching for.
 */

export interface OverlayData {
  vehicles: VehicleState[];
  vehicleById: Map<string, Vehicle>;
  routes: Route[];
  corridors: Corridor[];
  junctions: Junction[];
  junctionStates: Map<string, JunctionRuntimeState>;
  facilities: Facility[];
  incidents: Incident[];
  conflicts: Conflict[];
  hiddenVehicleIds: Set<string>;
  selection?: Selection;
}

export interface OverlayHandlers {
  onSelect(selection: Selection): void;
}

interface RouteLines {
  casing: google.maps.Polyline;
  line: google.maps.Polyline;
}

export class SmartErOverlay {
  private readonly vehicleMarkers = new Map<string, google.maps.Marker>();
  private readonly junctionMarkers = new Map<string, google.maps.Marker>();
  private readonly facilityMarkers = new Map<string, google.maps.Marker>();
  private readonly incidentMarkers = new Map<string, google.maps.Marker>();
  private readonly conflictMarkers = new Map<string, google.maps.Marker>();
  private readonly routeLines = new Map<string, RouteLines>();
  private readonly alternativeLines = new Map<string, google.maps.Polyline>();

  constructor(
    private readonly map: google.maps.Map,
    private readonly handlers: OverlayHandlers,
  ) {}

  render(data: OverlayData): void {
    this.renderRoutes(data);
    this.renderJunctions(data);
    this.renderFacilities(data);
    this.renderIncidents(data);
    this.renderVehicles(data);
    this.renderConflicts(data);
  }

  // -- routes ---------------------------------------------------------------

  private renderRoutes(data: OverlayData): void {
    const live = new Set<string>();

    for (const route of data.routes) {
      if (data.hiddenVehicleIds.has(route.vehicleId)) continue;
      if (route.path.length < 2) continue;
      live.add(route.id);

      const vehicle = data.vehicleById.get(route.vehicleId);
      const color = vehicle ? VEHICLE_KIND_COLOR[vehicle.kind] : '#4c8bff';
      const selected =
        data.selection?.kind === 'route'
          ? data.selection.id === route.id
          : data.selection?.kind === 'vehicle' && data.selection.id === route.vehicleId;

      const path = route.path as google.maps.LatLngLiteral[];
      const existing = this.routeLines.get(route.id);

      if (existing) {
        existing.casing.setPath(path);
        existing.line.setPath(path);
        existing.line.setOptions({ strokeColor: color, strokeWeight: selected ? 5 : 3.5, zIndex: selected ? 30 : 20 });
        existing.casing.setOptions({ strokeWeight: selected ? 9 : 7 });
      } else {
        // A white casing beneath the coloured line keeps routes legible where
        // they cross a road of a similar colour, or each other.
        const casing = new google.maps.Polyline({
          path,
          map: this.map,
          strokeColor: '#ffffff',
          strokeOpacity: 0.95,
          strokeWeight: selected ? 9 : 7,
          zIndex: 10,
          clickable: false,
        });
        const line = new google.maps.Polyline({
          path,
          map: this.map,
          strokeColor: color,
          strokeOpacity: 0.95,
          strokeWeight: selected ? 5 : 3.5,
          zIndex: selected ? 30 : 20,
          clickable: true,
        });
        line.addListener('click', () => this.handlers.onSelect({ kind: 'route', id: route.id }));
        this.routeLines.set(route.id, { casing, line });
      }

      this.renderAlternatives(route, selected);
    }

    for (const [id, lines] of this.routeLines) {
      if (live.has(id)) continue;
      lines.casing.setMap(null);
      lines.line.setMap(null);
      this.routeLines.delete(id);
      this.clearAlternatives(id);
    }
  }

  /**
   * Rejected alternatives, drawn dashed and dim, only for the selected route.
   * Showing every candidate for every unit at once would bury the live routes.
   */
  private renderAlternatives(route: Route, selected: boolean): void {
    if (!selected) {
      this.clearAlternatives(route.id);
      return;
    }

    route.alternatives.forEach((candidate, index) => {
      if (candidate.path.length < 2) return;
      // The first candidate is the one that was chosen and is already drawn.
      if (index === 0) return;
      const key = `${route.id}:${candidate.id}`;
      const existing = this.alternativeLines.get(key);
      if (existing) {
        existing.setPath(candidate.path as google.maps.LatLngLiteral[]);
        return;
      }

      const line = new google.maps.Polyline({
        path: candidate.path as google.maps.LatLngLiteral[],
        map: this.map,
        strokeOpacity: 0,
        zIndex: 5,
        clickable: false,
        icons: [
          {
            icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.55, strokeWeight: 2, scale: 3, strokeColor: '#98a2b3' },
            offset: '0',
            repeat: '11px',
          },
        ],
      });
      this.alternativeLines.set(key, line);
    });
  }

  private clearAlternatives(routeId: string): void {
    for (const [key, line] of this.alternativeLines) {
      if (!key.startsWith(`${routeId}:`)) continue;
      line.setMap(null);
      this.alternativeLines.delete(key);
    }
  }

  // -- junctions ------------------------------------------------------------

  private renderJunctions(data: OverlayData): void {
    for (const junction of data.junctions) {
      const state = data.junctionStates.get(junction.id)?.state ?? JunctionState.NORMAL;
      const style = JUNCTION_STATE_STYLE[state];
      const held = state === JunctionState.GREEN || state === JunctionState.PREPARING || state === JunctionState.CONFLICT;

      const existing = this.junctionMarkers.get(junction.id);
      const icon = {
        url: junctionMarkerIcon(junction.code, style.hex, held),
        scaledSize: new google.maps.Size(34, 34),
        anchor: new google.maps.Point(17, 17),
      };

      if (existing) {
        existing.setIcon(icon);
        existing.setZIndex(held ? 60 : 40);
        continue;
      }

      const marker = new google.maps.Marker({
        position: junction.position,
        map: this.map,
        icon,
        title: `${junction.code} — ${junction.name}`,
        zIndex: held ? 60 : 40,
        optimized: false,
      });
      marker.addListener('click', () => this.handlers.onSelect({ kind: 'junction', id: junction.id }));
      this.junctionMarkers.set(junction.id, marker);
    }
  }

  // -- facilities and incidents --------------------------------------------

  private renderFacilities(data: OverlayData): void {
    for (const facility of data.facilities) {
      if (this.facilityMarkers.has(facility.id)) continue;
      const marker = new google.maps.Marker({
        position: facility.position,
        map: this.map,
        icon: {
          url: facilityMarkerIcon(facility.kind),
          scaledSize: new google.maps.Size(26, 26),
          anchor: new google.maps.Point(13, 13),
        },
        title: facility.name,
        zIndex: 35,
        optimized: false,
      });
      marker.addListener('click', () => this.handlers.onSelect({ kind: 'facility', id: facility.id }));
      this.facilityMarkers.set(facility.id, marker);
    }
  }

  private renderIncidents(data: OverlayData): void {
    const live = new Set<string>();
    for (const incident of data.incidents) {
      if (incident.status === 'RESOLVED') continue;
      live.add(incident.id);
      if (this.incidentMarkers.has(incident.id)) continue;

      const marker = new google.maps.Marker({
        position: incident.position,
        map: this.map,
        icon: {
          url: facilityMarkerIcon('INCIDENT_SITE'),
          scaledSize: new google.maps.Size(24, 24),
          anchor: new google.maps.Point(12, 12),
        },
        title: `${incident.code} — ${incident.address}`,
        zIndex: 45,
        optimized: false,
      });
      marker.addListener('click', () => this.handlers.onSelect({ kind: 'incident', id: incident.id }));
      this.incidentMarkers.set(incident.id, marker);
    }

    for (const [id, marker] of this.incidentMarkers) {
      if (live.has(id)) continue;
      marker.setMap(null);
      this.incidentMarkers.delete(id);
    }
  }

  // -- vehicles -------------------------------------------------------------

  private renderVehicles(data: OverlayData): void {
    const live = new Set<string>();

    for (const state of data.vehicles) {
      if (state.status === 'OFFLINE') continue;
      const vehicle = data.vehicleById.get(state.vehicleId);
      if (!vehicle) continue;
      live.add(state.vehicleId);

      const hidden = data.hiddenVehicleIds.has(state.vehicleId);
      const corridor = data.corridors.find((entry) => entry.id === state.corridorId);
      const ringColor = corridorRingColor(corridor, state);
      const selected = data.selection?.kind === 'vehicle' && data.selection.id === state.vehicleId;

      const icon = {
        url: vehicleMarkerIcon(vehicle.kind, state.heading, ringColor, hidden || !state.gpsOk),
        scaledSize: new google.maps.Size(36, 36),
        anchor: new google.maps.Point(18, 18),
      };

      const existing = this.vehicleMarkers.get(state.vehicleId);
      if (existing) {
        existing.setPosition(state.position);
        existing.setIcon(icon);
        existing.setZIndex(selected ? 120 : 100);
        existing.setOpacity(hidden ? 0.35 : 1);
        continue;
      }

      const marker = new google.maps.Marker({
        position: state.position,
        map: this.map,
        icon,
        title: `${vehicle.callSign} — ${state.status}`,
        zIndex: selected ? 120 : 100,
        optimized: false,
      });
      marker.addListener('click', () => this.handlers.onSelect({ kind: 'vehicle', id: state.vehicleId }));
      this.vehicleMarkers.set(state.vehicleId, marker);
    }

    for (const [id, marker] of this.vehicleMarkers) {
      if (live.has(id)) continue;
      marker.setMap(null);
      this.vehicleMarkers.delete(id);
    }
  }

  // -- conflicts ------------------------------------------------------------

  private renderConflicts(data: OverlayData): void {
    const live = new Set<string>();

    for (const conflict of data.conflicts) {
      // Only unresolved contention is worth a marker; resolved conflicts stay
      // in the monitor panel but must not clutter the map.
      if (conflict.status !== 'DETECTED' && conflict.status !== 'UNRESOLVED') continue;
      const junction = data.junctions.find((entry) => entry.id === conflict.junctionId);
      if (!junction) continue;
      live.add(conflict.id);
      if (this.conflictMarkers.has(conflict.id)) continue;

      const marker = new google.maps.Marker({
        position: { lat: junction.position.lat + 0.0004, lng: junction.position.lng + 0.0004 },
        map: this.map,
        icon: {
          url: conflictMarkerIcon(),
          scaledSize: new google.maps.Size(30, 30),
          anchor: new google.maps.Point(15, 15),
        },
        title: `Conflict at ${junction.code}`,
        zIndex: 130,
        optimized: false,
      });
      marker.addListener('click', () => this.handlers.onSelect({ kind: 'conflict', id: conflict.id }));
      this.conflictMarkers.set(conflict.id, marker);
    }

    for (const [id, marker] of this.conflictMarkers) {
      if (live.has(id)) continue;
      marker.setMap(null);
      this.conflictMarkers.delete(id);
    }
  }

  // -- lifecycle ------------------------------------------------------------

  /** Frame a set of points, e.g. when the operator selects a unit. */
  fitTo(points: readonly LatLng[], padding = 80): void {
    if (points.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    for (const point of points) bounds.extend(point);
    this.map.fitBounds(bounds, padding);
  }

  destroy(): void {
    for (const collection of [
      this.vehicleMarkers,
      this.junctionMarkers,
      this.facilityMarkers,
      this.incidentMarkers,
      this.conflictMarkers,
    ]) {
      for (const marker of collection.values()) marker.setMap(null);
      collection.clear();
    }
    for (const lines of this.routeLines.values()) {
      lines.casing.setMap(null);
      lines.line.setMap(null);
    }
    this.routeLines.clear();
    for (const line of this.alternativeLines.values()) line.setMap(null);
    this.alternativeLines.clear();
  }
}

/**
 * The ring around a vehicle marker reports what its corridor is doing right
 * now, so a controller can read a unit's state from the map alone.
 */
function corridorRingColor(corridor: Corridor | undefined, state: VehicleState): string {
  if (!state.gpsOk) return JUNCTION_STATE_STYLE[JunctionState.OFFLINE].hex;
  if (!corridor) return '#667085';
  if (corridor.activeJunctionId) return JUNCTION_STATE_STYLE[JunctionState.GREEN].hex;
  if (corridor.preparingJunctionIds.length > 0) return JUNCTION_STATE_STYLE[JunctionState.PREPARING].hex;
  return '#667085';
}
