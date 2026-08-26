import { useEffect, useRef } from 'react';
import type { Route } from '@smart-er/core';
import { RouteSource } from '@smart-er/core';
import { api } from '@/api/client';
import { computeGoogleRoutes } from './routesService';

/**
 * Enrich SMART-ER routes with real Google road geometry.
 *
 * The Maps JavaScript Routes library runs in the browser, so the browser is
 * the only place that can obtain a road-following polyline and a traffic-aware
 * travel time. This hook asks Google for them whenever a new route appears and
 * posts the result back to the server.
 *
 * The division of labour is deliberate and is the whole architecture in
 * miniature: Google supplies geography, geometry and travel time; SMART-ER
 * decides which junctions to hold, in what order, and against which competing
 * emergency. The server keeps its own junction sequencing — only the drawn
 * path and the ETA are adopted — because Google has no idea which signals
 * SMART-ER controls or who else is running.
 *
 * A failure here is not an error state: the route keeps its graph geometry and
 * everything continues to work, just drawn on straighter lines.
 */
export function useRouteGeometrySync(routes: readonly Route[], mapsReady: boolean): void {
  // Routes already enriched (or attempted), so a route is never fetched twice.
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!mapsReady) return;

    const pending = routes.filter(
      (route) => route.active && route.source === RouteSource.GRAPH && !handled.current.has(route.id),
    );
    if (pending.length === 0) return;

    let cancelled = false;

    void (async () => {
      for (const route of pending) {
        handled.current.add(route.id);
        try {
          const result = await computeGoogleRoutes({
            origin: route.origin,
            destination: route.destination.position,
            alternatives: false,
          });
          if (cancelled) return;

          const best = result.routes[0];
          if (!best || best.path.length < 2 || result.backend === 'unavailable') continue;

          await api.applyRouteGeometry(route.id, {
            path: best.path,
            distanceM: best.distanceM || undefined,
            etaSeconds: best.etaSeconds || undefined,
            source:
              result.backend === 'routes-library' ? RouteSource.GOOGLE_ROUTES : RouteSource.GOOGLE_DIRECTIONS,
          });
        } catch {
          // Quota, an unroutable pair, or a permissions problem. The graph
          // geometry already on the route remains correct and usable.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routes, mapsReady]);
}
