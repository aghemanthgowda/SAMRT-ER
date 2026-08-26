/**
 * Deterministic pseudo-random source.
 *
 * The simulation must be reproducible: the same scenario and the same seed have
 * to produce the same traffic variation and the same GPS jitter, otherwise a
 * failing test cannot be re-run and a demo cannot be rehearsed.
 */
export class SeededRandom {
  private state: number;

  constructor(seed = 0x2f6e2b1) {
    this.state = seed >>> 0 || 1;
  }

  /** Uniform in [0, 1). xorshift32. */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return x / 0x100000000;
  }

  between(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.between(min, maxInclusive + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick: empty list');
    return items[this.int(0, items.length - 1)]!;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}
