import { useState } from 'react';
import { AlertCircle, Check, ChevronRight, X } from 'lucide-react';
import type { EmergencyRequest, Vehicle } from '@smart-er/core';
import { Severity, formatClock } from '@smart-er/core';
import { api } from '@/api/client';
import { Badge, Button, Empty } from '@/components/ui/primitives';
import { SEVERITY_STYLE } from '@/lib/status';
import { useOpsStore, usePendingRequests } from '@/stores/opsStore';

/**
 * The pending request queue.
 *
 * This is the controller's action list, so it is ordered by arrival, not by
 * severity: a CRITICAL request that arrived thirty seconds ago is still behind
 * one that has been waiting two minutes, and hiding that would let older calls
 * quietly starve. Severity is shown, loudly, but it does not reorder the queue.
 */
export function RequestQueue({ vehicleById }: { vehicleById: Map<string, Vehicle> }) {
  const pending = usePendingRequests();
  const select = useOpsStore((state) => state.select);
  const selection = useOpsStore((state) => state.selection);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const approve = async (request: EmergencyRequest) => {
    setBusyId(request.id);
    setError(undefined);
    try {
      await api.approveRequest(request.id);
    } catch (approveError) {
      setError((approveError as Error).message);
    } finally {
      setBusyId(undefined);
    }
  };

  const reject = async (request: EmergencyRequest) => {
    const reason = window.prompt(`Reason for declining ${request.vehicleId}'s request:`);
    if (!reason) return;
    setBusyId(request.id);
    setError(undefined);
    try {
      await api.rejectRequest(request.id, reason);
    } catch (rejectError) {
      setError((rejectError as Error).message);
    } finally {
      setBusyId(undefined);
    }
  };

  if (pending.length === 0) {
    return (
      <Empty
        icon={<Check className="size-5" />}
        message="No requests awaiting decision"
        hint="Incoming corridor requests appear here the moment a crew submits one."
      />
    );
  }

  return (
    <div>
      {error && (
        <p role="alert" className="border-b border-status-critical/30 bg-status-critical-dim px-2.5 py-1.5 text-[11px] text-status-critical">
          {error}
        </p>
      )}

      {pending.map((request) => {
        const vehicle = vehicleById.get(request.vehicleId);
        const severity = SEVERITY_STYLE[request.severity];
        const isCritical = request.severity === Severity.CRITICAL;
        const selected = selection?.kind === 'vehicle' && selection.id === request.vehicleId;

        return (
          <article
            key={request.id}
            data-selected={selected}
            className={`row-button cursor-pointer px-2.5 py-2 ${isCritical ? 'urgent border-l-2 border-l-status-critical' : ''}`}
            onClick={() => select({ kind: 'vehicle', id: request.vehicleId })}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="tnum font-mono text-xs font-semibold text-ground-50">{request.vehicleId}</span>
                  <Badge className={severity.chip}>{severity.label}</Badge>
                </div>

                <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-ground-300">
                  <ChevronRight className="size-3 shrink-0 text-ground-500" />
                  {request.destination.name}
                </p>

                {request.note && <p className="mt-0.5 truncate text-[11px] italic text-ground-400">{request.note}</p>}

                <p className="tnum mt-0.5 font-mono text-[10px] text-ground-500">
                  {formatClock(request.createdAt)} · {vehicle?.registrationNumber ?? request.organizationId}
                </p>
              </div>

              <div className="flex shrink-0 flex-col gap-1">
                <Button
                  size="sm"
                  variant="success"
                  disabled={busyId === request.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void approve(request);
                  }}
                >
                  <Check className="size-3" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busyId === request.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void reject(request);
                  }}
                >
                  <X className="size-3" />
                  Decline
                </Button>
              </div>
            </div>
          </article>
        );
      })}

      <p className="flex items-start gap-1.5 px-2.5 py-2 text-[10px] leading-relaxed text-ground-500">
        <AlertCircle className="mt-0.5 size-3 shrink-0" />
        Approving re-checks the driver, operator and telemetry unit before a corridor is armed.
      </p>
    </div>
  );
}
