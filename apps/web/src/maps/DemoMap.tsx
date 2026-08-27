import { useMemo } from 'react';
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
import { JunctionState, boundsOf } from '@smart-er/core';
import { JUNCTION_STATE_STYLE, TRAFFIC_STYLE, VEHICLE_KIND_COLOR } from '@/lib/status';
import type { Selection } from '@/stores/opsStore';

/**
 * Demo map — the fallback when no Google Maps API key is configured.
 *
 * This is deliberately not a pretend Google Maps. It draws the junction network
 * as a schematic, the way a signal-engineering diagram would, and labels itself
 * clearly as a fallback. Every operational capability still works on it: the
 * simulation runs, corridors roll, conflicts resolve. What is missing is real
 * geography, and the banner says so rather than letting anyone mistake this for
 * the real map.
 */

export interface DemoMapProps {
  junctions: Junction[];
  junctionStates: Map<string, JunctionRuntimeState>;
  roadSegments: { id: string; fromJunctionId: string; toJunctionId: string; traffic: string; blocked: boolean }[];
  routes: Route[];
  corridors: Corridor[];
  vehicles: VehicleState[];
  vehicleById: Map<string, Vehicle>;
  facilities: Facility[];
  incidents: Incident[];
  conflicts: Conflict[];
  hiddenVehicleIds: Set<string>;
  selection?: Selection;
  onSelect(selection: Selection): void;
}

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 680;
const PADDING = 56;

export function DemoMap(props: DemoMapProps) {
  const { junctions, roadSegments, routes, vehicles, vehicleById, facilities, incidents } = props;

  // Project WGS-84 onto the SVG viewport. An equirectangular projection with a
  // latitude correction is accurate enough over a few kilometres of city.
  const project = useMemo(() => {
    const points: LatLng[] = [
      ...junctions.map((junction) => junction.position),
      ...facilities.map((facility) => facility.position),
    ];
    if (points.length === 0) {
      return (point: LatLng) => ({ x: point.lng, y: point.lat });
    }

    const bounds = boundsOf(points, 0.0015);
    const latRef = ((bounds.north + bounds.south) / 2) * (Math.PI / 180);
    const lngScale = Math.cos(latRef);

    const spanLng = (bounds.east - bounds.west) * lngScale;
    const spanLat = bounds.north - bounds.south;
    const scale = Math.min(
      (VIEW_WIDTH - PADDING * 2) / (spanLng || 1),
      (VIEW_HEIGHT - PADDING * 2) / (spanLat || 1),
    );
    const offsetX = (VIEW_WIDTH - spanLng * scale) / 2;
    const offsetY = (VIEW_HEIGHT - spanLat * scale) / 2;

    return (point: LatLng) => ({
      x: offsetX + (point.lng - bounds.west) * lngScale * scale,
      // SVG y grows downward; latitude grows upward.
      y: offsetY + (bounds.north - point.lat) * scale,
    });
  }, [junctions, facilities]);

  const junctionById = useMemo(() => new Map(junctions.map((j) => [j.id, j])), [junctions]);

  return (
    <div className="relative size-full bg-canvas">
      {/*
        Stated once, quietly, and only here. The operator needs to know the
        geography is schematic — but this is a working fallback, not a fault,
        and an alarm-coloured banner across the top of the primary display
        would train people to ignore banners.
      */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center">
        <div className="mt-3 flex items-center gap-1.5 rounded-full border border-line bg-surface/95 px-3 py-1 shadow-card">
          <span className="size-1.5 rounded-full bg-warn-500" aria-hidden />
          <p className="text-[11.5px] font-medium text-ink-600">
            Schematic map — add a Google Maps API key for real geography
          </p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="size-full"
        role="img"
        aria-label="Schematic junction network"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <pattern id="demo-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#e6eaf1" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="#f4f6f9" />
        <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="url(#demo-grid)" />

        {/* Road network, coloured by live traffic. */}
        <g>
          {roadSegments.map((segment) => {
            const from = junctionById.get(segment.fromJunctionId);
            const to = junctionById.get(segment.toJunctionId);
            if (!from || !to) return null;
            // Each carriageway is drawn once; skip the reverse direction.
            if (segment.fromJunctionId > segment.toJunctionId) return null;

            const a = project(from.position);
            const b = project(to.position);
            const style = TRAFFIC_STYLE[segment.traffic as keyof typeof TRAFFIC_STYLE];
            return (
              <line
                key={segment.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={segment.blocked ? '#9f1239' : (style?.hex ?? '#cdd5e0')}
                strokeWidth={segment.blocked ? 3 : 5}
                strokeLinecap="round"
                strokeDasharray={segment.blocked ? '6 5' : undefined}
                opacity={0.5}
              />
            );
          })}
        </g>

        {/* Active routes. */}
        <g>
          {routes.map((route) => {
            if (props.hiddenVehicleIds.has(route.vehicleId) || route.path.length < 2) return null;
            const vehicle = vehicleById.get(route.vehicleId);
            const color = vehicle ? VEHICLE_KIND_COLOR[vehicle.kind] : '#4c8bff';
            const selected =
              props.selection?.kind === 'route'
                ? props.selection.id === route.id
                : props.selection?.kind === 'vehicle' && props.selection.id === route.vehicleId;
            const points = route.path.map((point) => {
              const p = project(point);
              return `${p.x},${p.y}`;
            });
            return (
              <g key={route.id}>
                <polyline points={points.join(' ')} fill="none" stroke="#ffffff" strokeWidth={selected ? 9 : 7} strokeLinecap="round" strokeLinejoin="round" />
                <polyline
                  points={points.join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth={selected ? 4.5 : 3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="cursor-pointer"
                  onClick={() => props.onSelect({ kind: 'route', id: route.id })}
                />
              </g>
            );
          })}
        </g>

        {/* Facilities. */}
        <g>
          {facilities.map((facility) => {
            const p = project(facility.position);
            const palette: Record<string, string> = {
              HOSPITAL: '#e5484d',
              FIRE_STATION: '#f5701f',
              POLICE_HQ: '#3d8bfd',
            };
            return (
              <rect
                key={facility.id}
                x={p.x - 7}
                y={p.y - 7}
                width={14}
                height={14}
                rx={3}
                fill={palette[facility.kind] ?? '#7c8da3'}
                stroke="#ffffff"
                strokeWidth={2}
                className="cursor-pointer"
                onClick={() => props.onSelect({ kind: 'facility', id: facility.id })}
              >
                <title>{facility.name}</title>
              </rect>
            );
          })}
        </g>

        {/* Incidents. */}
        <g>
          {incidents
            .filter((incident) => incident.status !== 'RESOLVED')
            .map((incident) => {
              const p = project(incident.position);
              return (
                <polygon
                  key={incident.id}
                  points={`${p.x},${p.y - 8} ${p.x + 8},${p.y + 6} ${p.x - 8},${p.y + 6}`}
                  fill="#f5a524"
                  stroke="#ffffff"
                  strokeWidth={2}
                  className="cursor-pointer"
                  onClick={() => props.onSelect({ kind: 'incident', id: incident.id })}
                >
                  <title>{`${incident.code} — ${incident.address}`}</title>
                </polygon>
              );
            })}
        </g>

        {/* Junctions. */}
        <g>
          {junctions.map((junction) => {
            const state = props.junctionStates.get(junction.id)?.state ?? JunctionState.NORMAL;
            const style = JUNCTION_STATE_STYLE[state];
            const held =
              state === JunctionState.GREEN || state === JunctionState.PREPARING || state === JunctionState.CONFLICT;
            const p = project(junction.position);
            return (
              <g
                key={junction.id}
                className="cursor-pointer"
                onClick={() => props.onSelect({ kind: 'junction', id: junction.id })}
              >
                <title>{`${junction.code} — ${junction.name} (${style.label})`}</title>
                {held && <circle cx={p.x} cy={p.y} r={15} fill="none" stroke={style.hex} strokeWidth={2} opacity={0.5} />}
                <circle cx={p.x} cy={p.y} r={held ? 12 : 9} fill="#ffffff" stroke={style.hex} strokeWidth={2.5} />
                <text
                  x={p.x}
                  y={p.y + 3.5}
                  textAnchor="middle"
                  fontSize={held ? 10 : 9}
                  fontWeight={700}
                  fill={style.hex}
                  className="select-none"
                >
                  {junction.code}
                </text>
              </g>
            );
          })}
        </g>

        {/* Vehicles. */}
        <g>
          {vehicles.map((state) => {
            if (state.status === 'OFFLINE') return null;
            const vehicle = vehicleById.get(state.vehicleId);
            if (!vehicle) return null;
            const hidden = props.hiddenVehicleIds.has(state.vehicleId);
            const p = project(state.position);
            const color = VEHICLE_KIND_COLOR[vehicle.kind];
            const selected = props.selection?.kind === 'vehicle' && props.selection.id === state.vehicleId;
            return (
              <g
                key={state.vehicleId}
                className="cursor-pointer"
                opacity={hidden ? 0.3 : 1}
                onClick={() => props.onSelect({ kind: 'vehicle', id: state.vehicleId })}
              >
                <title>{`${vehicle.callSign} — ${state.status}`}</title>
                <circle cx={p.x} cy={p.y} r={selected ? 13 : 11} fill={state.gpsOk ? '#ffffff' : '#ede9fe'} stroke={color} strokeWidth={2.5} />
                <circle cx={p.x} cy={p.y} r={5} fill={color} />
                <text x={p.x} y={p.y - 16} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={color} className="select-none">
                  {vehicle.callSign}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
