import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@smart-er/core';

export type SmartErSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

let socket: SmartErSocket | undefined;

/**
 * Connect the realtime channel.
 *
 * Reconnection is left to Socket.IO with a capped backoff. On reconnect the
 * client asks for a fresh snapshot rather than assuming the deltas it missed
 * were unimportant — a dashboard that silently drifts out of date is worse
 * than one that visibly disconnects.
 */
export function connectSocket(token: string): SmartErSocket {
  if (socket?.connected) return socket;
  socket?.disconnect();

  socket = io(BASE_URL || window.location.origin, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 6000,
    timeout: 12000,
  }) as SmartErSocket;

  return socket;
}

export function getSocket(): SmartErSocket | undefined {
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = undefined;
}
