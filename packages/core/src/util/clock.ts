/**
 * The system clock.
 *
 * Every timestamp SMART-ER produces — signal change times, corridor windows,
 * timeline entries — comes from here rather than from `Date.now()` directly.
 *
 * That indirection is not ceremony. Safety rules are expressed in seconds:
 * minimum green, amber, all-red clearance. The simulation can run at 4× for a
 * demo, and a test harness runs it as fast as the CPU allows. If signal timing
 * read wall-clock time while vehicles moved on simulated time, a junction would
 * appear to have been green for zero seconds no matter how far the ambulance
 * had travelled, and the validator would refuse every aspect change. One clock
 * keeps movement and timing on the same timebase whatever the speed.
 */
export interface Clock {
  /** Milliseconds since the epoch on this clock's timebase. */
  now(): number;
  /** The same instant as an ISO-8601 string. */
  iso(): string;
}

/** Wall-clock time. The default outside the simulation. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  iso(): string {
    return new Date().toISOString();
  }
}

/**
 * A clock the simulation drives.
 *
 * Starts at the current wall time so timestamps still look real, then advances
 * only when `advance` is called — by the simulated interval, scaled by the
 * simulation speed.
 */
export class SimulationClock implements Clock {
  private current: number;

  constructor(startAt: number = Date.now()) {
    this.current = startAt;
  }

  now(): number {
    return this.current;
  }

  iso(): string {
    return new Date(this.current).toISOString();
  }

  /** Move the clock forward. Negative values are ignored. */
  advance(seconds: number): void {
    if (seconds > 0) this.current += seconds * 1000;
  }

  set(at: number): void {
    this.current = at;
  }
}
