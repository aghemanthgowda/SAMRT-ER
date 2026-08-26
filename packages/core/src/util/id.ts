/**
 * Monotonic, human-readable identifiers.
 *
 * Emergency operations logs are read by people under time pressure, so ids
 * carry their entity prefix (`REQ-`, `COR-`) rather than being opaque UUIDs.
 */
const counters = new Map<string, number>();

export function nextId(prefix: string): string {
  const next = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, next);
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `${prefix}-${stamp}${String(next).padStart(3, '0')}`;
}

/** Reset the counters. Test-only helper so ids are deterministic per suite. */
export function resetIds(): void {
  counters.clear();
}
