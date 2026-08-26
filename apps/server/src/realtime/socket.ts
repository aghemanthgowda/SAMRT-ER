import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, User } from '@smart-er/core';
import { Role, VehicleStatus, isoNow } from '@smart-er/core';
import { AuthError, userFromToken } from '../auth/auth.js';
import { config } from '../config.js';
import type { AppContext } from '../services/context.js';

interface SocketData {
  user: User;
}

/**
 * Realtime gateway.
 *
 * Every dashboard receives its first paint from a `state.snapshot` and is then
 * kept current by deltas — nothing in the product polls or refreshes.
 *
 * Rooms scope what each role sees. A hospital receives corridor and vehicle
 * updates because it is tracking an inbound ambulance, but not signal-command
 * traffic, which is of no use to it and would be noise on the wire.
 */
export function attachRealtime(httpServer: HttpServer, context: AppContext): Server {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
    httpServer,
    {
      cors: { origin: config.corsOrigins, credentials: true },
      // Long-poll fallback matters on mobile networks, which is where drivers are.
      transports: ['websocket', 'polling'],
      pingInterval: 20000,
      pingTimeout: 25000,
    },
  );

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth as { token?: string } | undefined)?.token ??
      (typeof socket.handshake.query.token === 'string' ? socket.handshake.query.token : undefined);

    if (!token) {
      next(new Error('Authentication required.'));
      return;
    }
    try {
      socket.data.user = userFromToken(context.store, token);
      next();
    } catch (error) {
      next(new Error(error instanceof AuthError ? error.message : 'Authentication failed.'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    for (const room of roomsFor(user)) socket.join(room);

    socket.emit('state.snapshot', context.snapshot());

    socket.on('subscribe', (_payload, ack) => {
      socket.emit('state.snapshot', context.snapshot());
      ack?.(true);
    });

    // A driver handset can supply real browser geolocation instead of the
    // simulator's synthetic track.
    socket.on('driver.position', (payload) => {
      handleDriverPosition(context, socket, payload);
    });
  });

  // Fan domain events out to the rooms that care about them.
  context.bus.onAny((event, payload) => {
    const rooms = roomsForEvent(event);
    const emitter = rooms.length > 0 ? io.to(rooms) : io;
    // The union of every event signature is wider than any single emit; the
    // bus has already guaranteed the payload matches its event name.
    (emitter.emit as (name: string, data: unknown) => void)(event, payload);
  });

  return io;
}

function roomsFor(user: User): string[] {
  const rooms = [`role:${user.role}`, `user:${user.id}`];
  if (user.facilityId) rooms.push(`facility:${user.facilityId}`);
  if (user.driverId) rooms.push(`driver:${user.driverId}`);
  if (user.role === Role.CONTROLLER || user.role === Role.ADMIN) rooms.push('ops');
  return rooms;
}

/**
 * Which rooms an event goes to.
 *
 * Operational detail that only a control room can act on stays in `ops`;
 * everything else is broadcast, because a driver's ETA and a hospital's inbound
 * list both derive from the same vehicle and corridor updates.
 */
function roomsForEvent(event: string): string[] {
  const opsOnly = new Set([
    'signal.command',
    'signal.ack',
    'junction.updated',
    'junction.states',
    'hardware.updated',
    'traffic.updated',
    'impact.updated',
    'simulation.updated',
    'conflict.detected',
    'conflict.resolved',
  ]);
  return opsOnly.has(event) ? ['ops'] : [];
}

function handleDriverPosition(
  context: AppContext,
  socket: Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>,
  payload: { lat: number; lng: number; heading?: number; speedKph?: number; accuracy?: number },
): void {
  const user = socket.data.user;
  if (user.role !== Role.DRIVER || !user.driverId) return;

  const driver = context.store.driver(user.driverId);
  if (!driver) return;

  // Only the vehicle this driver is actually signed on to may be moved.
  const state = context.store.repositories.vehicleStates.find(
    (entry) => entry.driverId === user.driverId && driver.authorizedVehicleIds.includes(entry.vehicleId),
  )[0];
  if (!state) return;
  if (state.status === VehicleStatus.OFFLINE) return;

  if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) return;

  // Hand this vehicle over to handset GPS so the simulator stops driving it.
  context.simulation.setManualGps(state.vehicleId, true);

  const updated = {
    ...state,
    position: { lat: payload.lat, lng: payload.lng },
    heading: payload.heading ?? state.heading,
    speedKph: payload.speedKph ?? state.speedKph,
    gpsOk: true,
    gpsAccuracy: payload.accuracy ?? state.gpsAccuracy,
    updatedAt: isoNow(),
  };
  context.store.repositories.vehicleStates.put(updated);
  context.bus.emit('vehicle.state', updated);
}
