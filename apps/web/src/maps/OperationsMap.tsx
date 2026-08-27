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
            <div className="mt-3 flex max-w-[60ch] items-start gap-2 rounded-lg border border-critical-200 bg-critical-50 px-3 py-2 shadow-card">
              <AlertTriangle className="mt-px size-4 shrink-0 text-critical-600" />
              <p className="text-[12px] leading-relaxed text-critical-700">{error}</p>
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
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-canvas/80">
          <div className="flex items-center gap-2 text-[13px] text-ink-600">
            <Loader2 className="size-4 animate-spin" />
            Loading Google Maps
          </div>
        </div>
      )}

      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setTrafficVisible(!trafficVisible)}
          aria-pressed={trafficVisible}
          title="Toggle Google traffic layer"
          className={`flex size-8 items-center justify-center rounded-lg border shadow-card transition-colors ${
            trafficVisible
              ? 'border-brand-500 bg-brand-50 text-brand-600'
              : 'border-line bg-surface text-ink-500 hover:bg-surface-muted'
          }`}
        >
          <Layers className="size-4" />
        </button>
        <button
          type="button"
          onClick={recentre}
          title="Frame all active units"
          className="flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-500 shadow-card transition-colors hover:bg-surface-muted"
        >
          <Crosshair className="size-4" />
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
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg border border-line bg-surface/95 px-3 py-2 shadow-card">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">Junction state</p>
      <ul className="space-y-0.5">
        {junctionEntries.map((state) => (
          <li key={state} className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: JUNCTION_STATE_STYLE[state].hex }}
              aria-hidden
            />
            <span className="text-[11px] text-ink-600">{JUNCTION_STATE_STYLE[state].label}</span>
          </li>
        ))}
      </ul>
      <p className="mb-1 mt-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">Unit</p>
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
            <span className="text-[11px] text-ink-600">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
