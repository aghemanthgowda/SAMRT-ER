import {
  GraphRouteProvider,
  activeReservations,
  isoNow,
  nextId,
  projectedImpactScore,
  type Destination,
  type LatLng,
  type Route,
  type RouteCandidate,
} from '@smart-er/core';
import { RouteChoiceReason, RouteSource, formatDistance, formatEta } from '@smart-er/core';
import type { Store } from '../db/store.js';

export interface PlanRouteInput {
  requestId: string;
  vehicleId: string;
  origin: LatLng;
  destination: Destination;
  priority: number;
  /** Junctions to keep clear of if a reasonable alternative exists. */
  avoidJunctionIds?: string[];
  /** Junctions that must not be used — an offline controller, say. */
  excludeJunctionIds?: string[];
  reason?: RouteChoiceReason;
  supersedesRouteId?: string;
}

export interface PlannedRoute {
  route: Route;
  candidates: RouteCandidate[];
}

/**
 * Route planning.
 *
 * Wraps the graph route provider with everything the provider deliberately does
 * not know about: which junctions other corridors currently hold, which
 * junction controllers are unreachable, and how to describe the resulting
 * choice to a human.
 */
export class RoutingService {
  constructor(private readonly store: Store) {}

  /** Junctions no route should use because their controller cannot be reached. */
  unusableJunctionIds(): string[] {
    return this.store.graph.junctions
      .filter((junction) => !this.store.isDeviceUsable(junction.hardwareDeviceId))
      .map((junction) => junction.id);
  }

  candidates(input: PlanRouteInput, alternatives = 3): RouteCandidate[] {
    const priorityByVehicle = new Map(
      this.store.repositories.corridors.list().map((corridor) => {
        const allocation = corridor.allocations[0];
        return [corridor.vehicleId, allocation?.priority ?? 0] as const;
      }),
    );

    const reservations = activeReservations(this.store.activeCorridors(), priorityByVehicle).filter(
      (reservation) => reservation.vehicleId !== input.vehicleId,
    );

    const provider = new GraphRouteProvider(this.store.graph, {
      reservations,
      priority: input.priority,
    });

    const excluded = [...new Set([...(input.excludeJunctionIds ?? []), ...this.unusableJunctionIds()])];

    const found = provider.computeRoutesSync({
      origin: input.origin,
      destination: input.destination,
      alternatives,
      emergency: true,
      ...(input.avoidJunctionIds ? { avoidJunctionIds: input.avoidJunctionIds } : {}),
      ...(excluded.length > 0 ? { excludeJunctionIds: excluded } : {}),
    });

    // Replace the provider's rough impact proxy with the calibrated model.
    return found.map((candidate) => ({
      ...candidate,
      publicImpactScore: projectedImpactScore(candidate.junctionIds, this.store.graph.junctions),
    }));
  }

  plan(input: PlanRouteInput): PlannedRoute | undefined {
    const candidates = this.candidates(input);
    const chosen = candidates[0];
    if (!chosen) return undefined;

    const reason = input.reason ?? inferReason(chosen, candidates);
    const route: Route = {
      id: nextId('RTE'),
      requestId: input.requestId,
      vehicleId: input.vehicleId,
      origin: input.origin,
      destination: input.destination,
      junctionIds: chosen.junctionIds,
      segments: chosen.segments,
      path: chosen.path,
      distanceM: chosen.distanceM,
      etaSeconds: chosen.etaSeconds,
      source: chosen.source,
      reason,
      alternatives: candidates,
      explanation: explainChoice(chosen, candidates, reason),
      createdAt: isoNow(),
      ...(input.supersedesRouteId ? { supersedesRouteId: input.supersedesRouteId } : {}),
      active: true,
      progressIndex: 0,
    };

    return { route, candidates };
  }

  /**
   * Adopt Google-supplied geometry for an existing route.
   *
   * The browser holds the Maps JavaScript Routes library, so it is the browser
   * that can obtain real road geometry and a traffic-aware ETA. It posts them
   * back here, and the simulation then drives the vehicle along the actual road
   * polyline rather than along straight lines between junctions.
   *
   * Junction sequencing is left untouched: Google does not know which junctions
   * SMART-ER can hold, and the corridor is a reservation over those junctions.
   */
  applyGoogleGeometry(
    routeId: string,
    payload: { path: LatLng[]; distanceM?: number; etaSeconds?: number; source?: RouteSource },
  ): Route | undefined {
    const existing = this.store.repositories.routes.get(routeId);
    if (!existing || payload.path.length < 2) return undefined;

    const updated: Route = {
      ...existing,
      path: payload.path,
      distanceM: payload.distanceM ?? existing.distanceM,
      etaSeconds: payload.etaSeconds ?? existing.etaSeconds,
      source: payload.source ?? RouteSource.GOOGLE_ROUTES,
    };
    this.store.repositories.routes.put(updated);
    return updated;
  }
}

function inferReason(chosen: RouteCandidate, candidates: readonly RouteCandidate[]): RouteChoiceReason {
  if (candidates.length === 1) return RouteChoiceReason.ONLY_AVAILABLE;
  if (chosen.conflictingJunctionIds.length === 0 && candidates.some((c) => c.conflictingJunctionIds.length > 0)) {
    return RouteChoiceReason.CONFLICT_FREE_ALTERNATIVE;
  }
  return RouteChoiceReason.FASTEST_SAFE;
}

/**
 * Prose explanation of a route choice.
 *
 * Rendered verbatim in the controller's route-comparison panel. It always names
 * the alternatives that were rejected and why, because "the system chose this"
 * is not something a controller can defend afterwards.
 */
function explainChoice(
  chosen: RouteCandidate,
  candidates: readonly RouteCandidate[],
  reason: RouteChoiceReason,
): string {
  const lines: string[] = [];
  lines.push(
    `Selected ${chosen.label.toLowerCase()} route via ${chosen.junctionIds.join(' → ')}: ` +
      `${formatDistance(chosen.distanceM)}, ETA ${formatEta(chosen.etaSeconds)}.`,
  );

  const others = candidates.filter((candidate) => candidate.id !== chosen.id);
  for (const other of others) {
    const deltaEta = other.etaSeconds - chosen.etaSeconds;
    const deltaDistance = other.distanceM - chosen.distanceM;
    const shorterButSlower = deltaDistance < 0 && deltaEta > 0;
    const detail = shorterButSlower
      ? `${formatDistance(Math.abs(deltaDistance))} shorter but ${Math.round(deltaEta)} s slower — ` +
        `SMART-ER optimises response time, not distance`
      : `${formatDistance(other.distanceM)}, ETA ${formatEta(other.etaSeconds)} ` +
        `(${deltaEta >= 0 ? '+' : ''}${Math.round(deltaEta)} s)`;
    const conflictNote =
      other.conflictingJunctionIds.length > 0
        ? `; contends for ${other.conflictingJunctionIds.join(', ')}`
        : '';
    lines.push(`Rejected ${other.label.toLowerCase()} via ${other.junctionIds.join(' → ')}: ${detail}${conflictNote}.`);
  }

  if (reason === RouteChoiceReason.CONFLICT_FREE_ALTERNATIVE) {
    lines.push('Chosen because it is the fastest option that shares no junction with an active corridor.');
  } else if (reason === RouteChoiceReason.ONLY_AVAILABLE) {
    lines.push('No alternative route exists on the current network state.');
  } else {
    lines.push('Chosen as the fastest safe route on current traffic conditions.');
  }

  return lines.join(' ');
}
