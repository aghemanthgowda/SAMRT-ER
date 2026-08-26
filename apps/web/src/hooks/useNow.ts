import { useEffect, useState } from 'react';

/**
 * A ticking clock for the console header and for anything counting down.
 *
 * Updates once a second, which is the resolution operators actually read.
 * Faster would burn battery on a driver handset for no visible benefit.
 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
