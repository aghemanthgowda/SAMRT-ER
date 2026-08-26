import type { Timestamp } from '../types/domain.js';

/** Format seconds as MM:SS, the ETA format used across every dashboard. */
export function formatEta(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) return '—';
  const clamped = Math.max(0, Math.round(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Format a timestamp as HH:MM:SS in the viewer's locale. */
export function formatClock(ts: Timestamp | Date): string {
  const date = typeof ts === 'string' ? new Date(ts) : ts;
  return date.toLocaleTimeString(undefined, { hour12: false });
}

export function formatDistance(metres: number | undefined | null): string {
  if (metres === undefined || metres === null || !Number.isFinite(metres)) return '—';
  if (metres < 950) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

export function isoNow(offsetSeconds = 0): Timestamp {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

export function isoAdd(base: Timestamp, seconds: number): Timestamp {
  return new Date(new Date(base).getTime() + seconds * 1000).toISOString();
}

export function secondsBetween(a: Timestamp, b: Timestamp): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 1000;
}

/** Signed seconds from now until `ts`. Negative when `ts` is in the past. */
export function secondsUntil(ts: Timestamp, now: number = Date.now()): number {
  return (new Date(ts).getTime() - now) / 1000;
}
