import type { LatLng, RouteCandidate } from '@smart-er/core';
import { RouteSource, decodePolyline, nextId } from '@smart-er/core';
import { loadMapsLibrary } from './loader';

/**
 * Google Maps routing.
 *
 * Prefers the current Routes library (`google.maps.routes`), which provides
 * `Route.computeRoutes` and `RouteMatrix.computeRouteMatrix` with traffic-aware
 * travel times and alternative routes:
 *   https://developers.google.com/maps/documentation/javascript/routes/overview
 *
 * That library is published on the beta channel. When the configured channel
 * does not expose it, this falls back to DirectionsService / DistanceMatrixService
 * so the product still gets real road geometry and ETAs rather than degrading
 * to the demo map. Which path answered is reported, and shown in the UI, so a
 * controller is never misled about where an ETA came from.
 */

export type RoutingBackend = 'routes-library' | 'directions-service' | 'unavailable';

export interface GoogleRouteResult {
  backend: RoutingBackend;
  routes: {
    path: LatLng[];
    distanceM: number;
    /** Traffic-aware where the backend provides it. */
    etaSeconds: number;
    /** Google's own summary, e.g. "MG Road". */
    summary: string;
    /** True for the first route Google returns. */
    primary: boolean;
  }[];
}

export interface GoogleRouteRequest {
  origin: LatLng;
  destination: LatLng;
  /** Ask Google for alternatives so the controller can compare. */
  alternatives?: boolean;
  departAt?: Date;
}

// The Routes library is newer than the shipped @types/google.maps, so its shape
// is described here rather than cast away with `any` at each call site.
interface RoutesLibraryShape {
  Route?: {
    computeRoutes?: (request: unknown) => Promise<{ routes?: RoutesApiRoute[] }>;
  };
  RouteMatrix?: {
    computeRouteMatrix?: (request: unknown) => Promise<unknown>;
  };
}

interface RoutesApiRoute {
  legs?: { distanceMeters?: number; durationMillis?: number }[];
  path?: { lat: number; lng: number }[] | google.maps.LatLng[];
  polyline?: { encodedPolyline?: string };
  encodedPolyline?: string;
  distanceMeters?: number;
  durationMillis?: number;
  duration?: string | number;
  description?: string;
  summary?: string;
}

export async function computeGoogleRoutes(request: GoogleRouteRequest): Promise<GoogleRouteResult> {
  const viaRoutesLibrary = await tryRoutesLibrary(request);
  if (viaRoutesLibrary) return viaRoutesLibrary;

  const viaDirections = await tryDirectionsService(request);
  if (viaDirections) return viaDirections;

  return { backend: 'unavailable', routes: [] };
}

async function tryRoutesLibrary(request: GoogleRouteRequest): Promise<GoogleRouteResult | undefined> {
  try {
    const library = await loadMapsLibrary<RoutesLibraryShape>('routes');
    const compute = library.Route?.computeRoutes;
    if (typeof compute !== 'function') return undefined;

    const response = await compute.call(library.Route, {
      origin: request.origin,
      destination: request.destination,
      travelMode: 'DRIVING',
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: request.alternatives ?? true,
      ...(request.departAt ? { departureTime: request.departAt } : {}),
      fields: ['path', 'durationMillis', 'distanceMeters', 'description', 'legs'],
    });

    const routes = (response.routes ?? []).map((route, index) => normaliseRoutesApiRoute(route, index));
    const usable = routes.filter((route) => route.path.length >= 2);
    if (usable.length === 0) return undefined;

    return { backend: 'routes-library', routes: usable };
  } catch {
    // Beta library absent, or the request was rejected — fall through.
    return undefined;
  }
}

function normaliseRoutesApiRoute(route: RoutesApiRoute, index: number) {
  const path = extractPath(route);
  const distanceM =
    route.distanceMeters ?? (route.legs ?? []).reduce((total, leg) => total + (leg.distanceMeters ?? 0), 0);
  const durationMillis =
    route.durationMillis ?? (route.legs ?? []).reduce((total, leg) => total + (leg.durationMillis ?? 0), 0);

  return {
    path,
    distanceM: Math.round(distanceM),
    etaSeconds: Math.round(durationMillis / 1000) || parseDurationSeconds(route.duration),
    summary: route.description ?? route.summary ?? (index === 0 ? 'Fastest' : `Alternative ${index}`),
    primary: index === 0,
  };
}

function extractPath(route: RoutesApiRoute): LatLng[] {
  if (Array.isArray(route.path) && route.path.length > 0) {
    return route.path.map((point) =>
      typeof (point as google.maps.LatLng).lat === 'function'
        ? { lat: (point as google.maps.LatLng).lat(), lng: (point as google.maps.LatLng).lng() }
        : { lat: (point as LatLng).lat, lng: (point as LatLng).lng },
    );
  }
  const encoded = route.polyline?.encodedPolyline ?? route.encodedPolyline;
  return encoded ? decodePolyline(encoded) : [];
}

/** Routes API durations are sometimes protobuf strings, e.g. "377s". */
function parseDurationSeconds(duration: string | number | undefined): number {
  if (typeof duration === 'number') return Math.round(duration);
  if (typeof duration === 'string') {
    const parsed = Number.parseFloat(duration.replace(/s$/, ''));
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return 0;
}

async function tryDirectionsService(request: GoogleRouteRequest): Promise<GoogleRouteResult | undefined> {
  try {
    const routesLib = await loadMapsLibrary<typeof google.maps>('routes').catch(() => undefined);
    void routesLib;
    await loadMapsLibrary<unknown>('maps');
    const service = new google.maps.DirectionsService();

    const response = await service.route({
      origin: request.origin,
      destination: request.destination,
      travelMode: google.maps.TravelMode.DRIVING,
      provideRouteAlternatives: request.alternatives ?? true,
      drivingOptions: {
        departureTime: request.departAt ?? new Date(),
        trafficModel: google.maps.TrafficModel.BEST_GUESS,
      },
    });

    const routes = response.routes.map((route, index) => {
      const leg = route.legs[0];
      const path = (route.overview_path ?? []).map((point) => ({ lat: point.lat(), lng: point.lng() }));
      return {
        path,
        distanceM: route.legs.reduce((total, entry) => total + (entry.distance?.value ?? 0), 0),
        // duration_in_traffic is the traffic-aware figure when available.
        etaSeconds:
          leg?.duration_in_traffic?.value ??
          route.legs.reduce((total, entry) => total + (entry.duration?.value ?? 0), 0),
        summary: route.summary || (index === 0 ? 'Fastest' : `Alternative ${index}`),
        primary: index === 0,
      };
    });

    const usable = routes.filter((route) => route.path.length >= 2);
    if (usable.length === 0) return undefined;
    return { backend: 'directions-service', routes: usable };
  } catch {
    return undefined;
  }
}

/**
 * Travel-time matrix across several origins and one or more destinations.
 * Used when comparing which unit should take a call.
 */
export interface GoogleMatrixCell {
  originIndex: number;
  destinationIndex: number;
  distanceM: number;
  etaSeconds: number;
  reachable: boolean;
}

export async function computeGoogleMatrix(
  origins: LatLng[],
  destinations: LatLng[],
): Promise<{ backend: RoutingBackend; cells: GoogleMatrixCell[] }> {
  try {
    const library = await loadMapsLibrary<RoutesLibraryShape>('routes');
    const compute = library.RouteMatrix?.computeRouteMatrix;
    if (typeof compute === 'function') {
      const response = (await compute.call(library.RouteMatrix, {
        origins: origins.map((origin) => ({ waypoint: origin })),
        destinations: destinations.map((destination) => ({ waypoint: destination })),
        travelMode: 'DRIVING',
        routingPreference: 'TRAFFIC_AWARE',
        fields: ['originIndex', 'destinationIndex', 'distanceMeters', 'durationMillis', 'condition'],
      })) as { originIndex: number; destinationIndex: number; distanceMeters?: number; durationMillis?: number; condition?: string }[];

      const cells = (Array.isArray(response) ? response : []).map((cell) => ({
        originIndex: cell.originIndex,
        destinationIndex: cell.destinationIndex,
        distanceM: Math.round(cell.distanceMeters ?? 0),
        etaSeconds: Math.round((cell.durationMillis ?? 0) / 1000),
        reachable: cell.condition !== 'ROUTE_NOT_FOUND',
      }));
      if (cells.length > 0) return { backend: 'routes-library', cells };
    }
  } catch {
    // fall through to the legacy service
  }

  try {
    await loadMapsLibrary<unknown>('maps');
    const service = new google.maps.DistanceMatrixService();
    const response = await service.getDistanceMatrix({
      origins,
      destinations,
      travelMode: google.maps.TravelMode.DRIVING,
      drivingOptions: { departureTime: new Date(), trafficModel: google.maps.TrafficModel.BEST_GUESS },
    });

    const cells: GoogleMatrixCell[] = [];
    response.rows.forEach((row, originIndex) => {
      row.elements.forEach((element, destinationIndex) => {
        cells.push({
          originIndex,
          destinationIndex,
          distanceM: element.distance?.value ?? 0,
          etaSeconds: element.duration_in_traffic?.value ?? element.duration?.value ?? 0,
          reachable: element.status === 'OK',
        });
      });
    });
    return { backend: 'directions-service', cells };
  } catch {
    return { backend: 'unavailable', cells: [] };
  }
}

/** Present a Google result as SMART-ER route candidates for the comparison panel. */
export function toRouteCandidates(result: GoogleRouteResult): RouteCandidate[] {
  return result.routes.map((route, index) => ({
    id: nextId('GRC'),
    junctionIds: [],
    segments: [],
    distanceM: route.distanceM,
    etaSeconds: route.etaSeconds,
    path: route.path,
    source: result.backend === 'routes-library' ? RouteSource.GOOGLE_ROUTES : RouteSource.GOOGLE_DIRECTIONS,
    conflictingJunctionIds: [],
    publicImpactScore: 0,
    cost: route.etaSeconds,
    label: route.summary || (index === 0 ? 'Google fastest' : `Google alternative ${index}`),
  }));
}
