import { useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, Crosshair, Layers, Loader2 } from 'lucide-react';
import type { Vehicle } from '@smart-er/core';
import { JunctionState } from '@smart-er/core';
import { JUNCTION_STATE_STYLE, VEHICLE_KIND_COLOR } from '@/lib/status';
import { useOpsStore, type Selection } from '@/stores/opsStore';
import { DemoMap } from './DemoMap';
import { useGoogleMap } from './useGoogleMap';
import { SmartErOverlay } from './overlay';
import { useRouteGeometrySync } from './useRouteGeometrySync';

/**
 * The console's geographic view.
 *
 * Google Maps is the map whenever a key is configured — it is the road network,
 * the traffic layer and the geography. SMART-ER's overlay draws the emergency
 * intelligence on top: routes, corridors, junction states, conflicts.
 *
 * With no key the same operational layer renders on the schematic demo map, so
 * every capability remains demonstrable without a billing account.
 */
export function OperationsMap({
  vehicleById,
  className,
}: {
  vehicleById: Map<string, Vehicle>;
  className?: string;
}) {
  const { containerRef, map, availability, error, trafficVisible, setTrafficVisible } = useGoogleMap();

  const junctions = useOpsStore((state) => state.junctions);
  const junctionStates = useOpsStore((state) => state.junctionStates);
  const roadSegments = useOpsStore((state) => state.roadSegments);
  const routesMap = useOpsStore((state) => state.routes);
  const corridorsMap = useOpsStore((state) => state.corridors);
  const vehiclesMap = useOpsStore((state) => state.vehicles);
  const conflictsMap = useOpsStore((state) => state.conflicts);
  const incidentsMap = useOpsStore((state) => state.incidents);
  const facilities = useOpsStore((state) => state.facilities);
  const hiddenVehicleIds = useOpsStore((state) => state.hiddenVehicleIds);
  const selection = useOpsStore((state) => state.selection);
  const select = useOpsStore((state) => state.select);

  const routes = useMemo(() => Object.values(routesMap).filter((route) => route.active), [routesMap]);
  const corridors = useMemo(() => Object.values(corridorsMap), [corridorsMap]);
  const vehicles = useMemo(() => Object.values(vehiclesMap), [vehiclesMap]);
  const conflicts = useMemo(() => Object.values(conflictsMap), [conflictsMap]);
  const incidents = useMemo(() => Object.values(incidentsMap), [incidentsMap]);
  const junctionStateMap = useMemo(() => new Map(Object.entries(junctionStates)), [junctionStates]);

  // Ask Google for real road geometry for each new route and hand it back to
  // the server, so simulated vehicles follow actual roads.
  useRouteGeometrySync(routes, availability === 'ready');

  const overlayRef = useRef<SmartErOverlay | undefined>(undefined);

  useEffect(() => {
    if (!map) return;
    const overlay = new SmartErOverlay(map, { onSelect: (value: Selection) => select(value) });
    overlayRef.current = overlay;
    return () => {
      overlay.destroy();
      overlayRef.current = undefined;
    };
  }, [map, select]);

  useEffect(() => {
    overlayRef.current?.render({
      vehicles,
      vehicleById,
      routes,
      corridors,
      junctions,
      junctionStates: junctionStateMap,
      facilities,
      incidents,
      conflicts,
      hiddenVehicleIds,
      selection,
    });
  }, [
    vehicles,
    vehicleById,
    routes,
    corridors,
    junctions,
    junctionStateMap,
    facilities,
    incidents,
    conflicts,
    hiddenVehicleIds,
    selection,
  ]);

  const recentre = () => {
    const points = vehicles
      .filter((vehicle) => vehicle.status !== 'OFFLINE')
      .map((vehicle) => vehicle.position);
    const fallback = junctions.map((junction) => junction.position);
    overlayRef.current?.fitTo(points.length > 0 ? points : fallback);
  };

  if (availability === 'unavailable' || availability === 'error') {
    return (
      <div className={className}>
        {availability === 'error' && error && (
          <div className="absolute inset-x-0 top-0 z-20 flex justify-center">
            <div className="mt-2 flex items-start gap-2 rounded-[3px] border border-status-critical/40 bg-status-critical-dim px-3 py-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-status-critical" />
              <p className="max-w-[52ch] text-[11px] text-status-critical">{error}</p>
            </div>
          </div>
        )}
        <DemoMap
          junctions={junctions}
          junctionStates={junctionStateMap}
          roadSegments={roadSegments}
          routes={routes}
          corridors={corridors}
          vehicles={vehicles}
          vehicleById={vehicleById}
          facilities={facilities}
          incidents={incidents}
          conflicts={conflicts}
          hiddenVehicleIds={hiddenVehicleIds}
          selection={selection}
          onSelect={select}
        />
        <MapLegend />
      </div>
    );
  }

  return (
    <div className={className}>
      <div ref={containerRef} className="size-full" role="application" aria-label="Operations map" />

      {availability === 'loading' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-ground-950/80">
          <div className="flex items-center gap-2 text-xs text-ground-300">
            <Loader2 className="size-4 animate-spin" />
            Loading Google Maps
          </div>
        </div>
      )}

      <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setTrafficVisible(!trafficVisible)}
          aria-pressed={trafficVisible}
          title="Toggle Google traffic layer"
          className={`flex size-7 items-center justify-center rounded-[3px] border transition-colors ${
            trafficVisible
              ? 'border-accent-500 bg-accent-500/20 text-accent-400'
              : 'border-ground-600 bg-ground-850 text-ground-300 hover:bg-ground-800'
          }`}
        >
          <Layers className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={recentre}
          title="Frame all active units"
          className="flex size-7 items-center justify-center rounded-[3px] border border-ground-600 bg-ground-850 text-ground-300 transition-colors hover:bg-ground-800"
        >
          <Crosshair className="size-3.5" />
        </button>
      </div>

      <MapLegend />
    </div>
  );
}

/**
 * The legend is not decoration: the map encodes junction state entirely in
 * colour, and a controller who has to remember what amber means is a
 * controller who will eventually get it wrong.
 */
function MapLegend() {
  const junctionEntries = [
    JunctionState.GREEN,
    JunctionState.PREPARING,
    JunctionState.CONFLICT,
    JunctionState.RELEASED,
    JunctionState.NORMAL,
  ];

  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-[3px] border border-ground-700 bg-ground-900/95 px-2.5 py-2">
      <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-ground-400">Junction state</p>
      <ul className="space-y-0.5">
        {junctionEntries.map((state) => (
          <li key={state} className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: JUNCTION_STATE_STYLE[state].hex }}
              aria-hidden
            />
            <span className="text-[10px] text-ground-300">{JUNCTION_STATE_STYLE[state].label}</span>
          </li>
        ))}
      </ul>
      <p className="mb-1 mt-2 text-[9px] font-semibold uppercase tracking-wider text-ground-400">Unit</p>
      <ul className="space-y-0.5">
        {(
          [
            ['AMBULANCE', 'Ambulance'],
            ['FIRE_TRUCK', 'Fire'],
            ['POLICE_UNIT', 'Police'],
          ] as const
        ).map(([kind, label]) => (
          <li key={kind} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: VEHICLE_KIND_COLOR[kind] }} aria-hidden />
            <span className="text-[10px] text-ground-300">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
