import { useEffect, useRef } from 'react';
import { formatClock } from '@smart-er/core';
import { Empty } from '@/components/ui/primitives';
import { useOpsStore } from '@/stores/opsStore';

/**
 * The incident timeline.
 *
 * A chronological record of every consequential decision, in the order it
 * happened. This is what a debrief is conducted from, so it is written for a
 * person: not "corridor.junction.released" but "J2 released — AMB-01 has
 * passed, junction back to public traffic".
 *
 * It auto-scrolls only while the operator is already at the bottom. Yanking the
 * view away from someone reading back through an incident is the fastest way to
 * make a live log useless.
 */

const KIND_COLOR: { match: RegExp; color: string }[] = [
  { match: /^conflict\./, color: '#e5484d' },
  { match: /^safety\./, color: '#e5484d' },
  { match: /^signal\.(nack|abandoned)/, color: '#e5484d' },
  { match: /^(gps\.lost|hardware\.offline|road\.blocked)/, color: '#8b5cf6' },
  { match: /^junction\.green/, color: '#30a46c' },
  { match: /^junction\.preparing/, color: '#f5a524' },
  { match: /^junction\.released/, color: '#6b8098' },
  { match: /^(request\.approved|corridor\.activated|vehicle\.verified)/, color: '#30a46c' },
  { match: /^(request\.rejected|request\.cancelled)/, color: '#e5484d' },
  { match: /^route\.rerouted/, color: '#3d8bfd' },
  { match: /^(request\.submitted|request\.received)/, color: '#f5a524' },
];

function colorFor(kind: string): string {
  return KIND_COLOR.find((entry) => entry.match.test(kind))?.color ?? '#4d6076';
}

export function IncidentTimeline({ filterVehicleId }: { filterVehicleId?: string }) {
  const timeline = useOpsStore((state) => state.timeline);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottom = useRef(true);

  const events = filterVehicleId
    ? timeline.filter((event) => event.vehicleId === filterVehicleId)
    : timeline;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !pinnedToBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [events.length]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    pinnedToBottom.current = distanceFromBottom < 32;
  };

  if (events.length === 0) {
    return <Empty message="No events yet" hint="Every decision the system makes is recorded here as it happens." />;
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
      <ol>
        {events.map((event) => (
          <li key={event.id} className="flex gap-2 border-b border-ground-800 px-2.5 py-1.5 last:border-b-0">
            <time
              className="tnum shrink-0 pt-px font-mono text-[10px] text-ground-500"
              dateTime={event.at}
            >
              {formatClock(event.at)}
            </time>
            <span
              className="mt-1 size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: colorFor(event.kind) }}
              aria-hidden
            />
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-ground-200">{event.message}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
