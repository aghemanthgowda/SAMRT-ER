import { useState } from 'react';
import { Ambulance, Check, Flame, ShieldCheck, X } from 'lucide-react';
import type { EmergencyRequest, Vehicle } from '@smart-er/core';
import { Severity, VehicleKind } from '@smart-er/core';
import { api } from '@/api/client';
import { Badge, Button, Empty } from '@/components/ui/primitives';
import { SEVERITY_STYLE, VEHICLE_KIND_COLOR } from '@/lib/status';
import { VehicleImage } from '@/components/brand/VehicleImage';
import { useOpsStore, usePendingRequests } from '@/stores/opsStore';

const KIND_ICON = {
  [VehicleKind.AMBULANCE]: Ambulance,
  [VehicleKind.FIRE_TRUCK]: Flame,
  [VehicleKind.POLICE_UNIT]: ShieldCheck,
} as const;

/**
 * Incoming corridor requests awaiting a decision.
 *
 * Ordered by arrival, not by severity: a CRITICAL request that arrived thirty
 * seconds ago is still behind one that has been waiting two minutes, and
 * reordering would let older calls quietly starve. Severity is shown, loudly,
 * but it does not jump the queue.
 *
 * Approving runs the whole pipeline server-side — verification, routing,
 * conflict detection and resolution, corridor arming, destination
 * notification. The button does not merely change a status field.
 */
export function RequestQueuePanel({
  vehicleById,
  compact,
}: {
  vehicleById: Map<string, Vehicle>;
  /** Dashboard shows a short list; the Requests page shows full detail. */
  compact?: boolean;
}) {
  const pending = usePendingRequests();
  const select = useOpsStore((state) => state.select);
  const selection = useOpsStore((state) => state.selection);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const act = async (request: EmergencyRequest, action: 'approve' | 'reject') => {
    let reason: string | null = null;
    if (action === 'reject') {
      reason = window.prompt(`Reason for declining ${request.vehicleId}'s request:`);
      if (!reason) return;
    }

    setBusyId(request.id);
    setError(undefined);
    try {
      if (action === 'approve') await api.approveRequest(request.id);
      else await api.rejectRequest(request.id, reason!);
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusyId(undefined);
    }
  };

  if (pending.length === 0) {
    return (
      <Empty
        icon={<Check className="size-5" />}
        message="No requests awaiting decision"
        hint="Corridor requests appear here the moment a crew submits one."
      />
    );
  }

  const rows = compact ? pending.slice(0, 4) : pending;

  return (
    <div>
      {error && (
        <p role="alert" className="border-b border-critical-200 bg-critical-50 px-4 py-2 text-[12.5px] text-critical-700">
          {error}
        </p>
      )}

      <ul className="divide-y divide-line">
        {rows.map((request) => {
          const vehicle = vehicleById.get(request.vehicleId);
          const Icon = vehicle ? KIND_ICON[vehicle.kind] : Ambulance;
          const color = vehicle ? VEHICLE_KIND_COLOR[vehicle.kind] : '#667085';
          const severity = SEVERITY_STYLE[request.severity];
          const critical = request.severity === Severity.CRITICAL;
          const selected = selection?.kind === 'vehicle' && selection.id === request.vehicleId;

          return (
            <li key={request.id}>
              <div
                data-selected={selected}
                className={`row-button cursor-pointer px-4 py-3 ${critical ? 'border-l-2 border-l-critical-500' : ''}`}
                onClick={() => select({ kind: 'vehicle', id: request.vehicleId })}
              >
                <div className="flex items-start gap-3">
                  {vehicle ? (
                    <VehicleImage kind={vehicle.kind} className="vehicle-icon-sm shrink-0" />
                  ) : (
                    <div className="flex size-8 shrink-0 items-center justify-center" style={{ color }}>
                      <Icon className="size-4" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="tnum font-mono text-[13.5px] font-semibold text-ink-900">
                        {request.vehicleId}
                      </span>
                      <Badge className={severity.chip}>{severity.label}</Badge>
                      <span className="rounded border border-warn-200 bg-warn-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-warn-700">
                        Pending
                      </span>
                    </div>
                    <p className="truncate text-[12.5px] text-ink-700">{request.destination.name}</p>
                    {request.note && (
                      <p className="truncate text-[11.5px] italic text-ink-500">{request.note}</p>
                    )}
                    <p className="tnum font-mono text-[10.5px] text-ink-400">
                      {relativeTime(request.createdAt)} · {request.driverId}
                      {vehicle && ` · ${vehicle.registrationNumber}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busyId === request.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void act(request, 'approve');
                      }}
                    >
                      <Check className="size-3.5" />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busyId === request.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void act(request, 'reject');
                      }}
                    >
                      <X className="size-3.5" />
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {compact && pending.length > rows.length && (
        <p className="border-t border-line px-4 py-2 text-[12px] text-ink-500">
          {pending.length - rows.length} more awaiting decision
        </p>
      )}
    </div>
  );
}

/** "2 min ago" — the form a controller reads fastest for a queue age. */
function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ago`;
}
