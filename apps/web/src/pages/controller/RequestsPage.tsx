import { Card } from '@/components/ui/primitives';
import { DetailPanel } from '@/components/panels/DetailPanel';
import { RequestQueuePanel } from '@/components/dashboard/RequestQueuePanel';
import { ControllerLayout } from '@/components/shell/ControllerLayout';
import { useVehicleIndex } from '@/hooks/useVehicleIndex';
import { useOpsStore, usePendingRequests } from '@/stores/opsStore';
import { Badge, Empty } from '@/components/ui/primitives';
import { REQUEST_STATUS_STYLE, SEVERITY_STYLE } from '@/lib/status';
import { formatClock, formatEta } from '@smart-er/core';

/**
 * Corridor requests — pending decisions, then everything already decided.
 *
 * Accepting from here runs the same server-side pipeline as accepting from the
 * dashboard: verify the identity chain, plan a route, detect and resolve
 * conflicts against corridors already running, arm the rolling corridor and
 * notify the destination.
 */
export function RequestsPage() {
  const { vehicleById } = useVehicleIndex();
  const pending = usePendingRequests();
  const allRequests = useOpsStore((state) => state.requests);
  const routes = useOpsStore((state) => state.routes);
  const select = useOpsStore((state) => state.select);

  const decided = Object.values(allRequests)
    .filter((request) => request.status !== 'PENDING')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 40);

  return (
    <ControllerLayout
      title="Requests"
      subtitle={pending.length > 0 ? `${pending.length} awaiting decision` : 'No requests awaiting decision'}
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="space-y-3">
          <Card title="Awaiting decision" noPadding>
            <RequestQueuePanel vehicleById={vehicleById} />
          </Card>

          <Card title="Decided" noPadding>
            {decided.length === 0 ? (
              <Empty message="Nothing decided yet" hint="Approved and declined requests are recorded here." />
            ) : (
              <ul className="divide-y divide-line">
                {decided.map((request) => {
                  const style = REQUEST_STATUS_STYLE[request.status];
                  const route = request.routeId ? routes[request.routeId] : undefined;
                  return (
                    <li key={request.id}>
                      <button
                        type="button"
                        onClick={() => select({ kind: 'vehicle', id: request.vehicleId })}
                        className="row-button px-4 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="tnum font-mono text-[13px] font-semibold text-ink-900">
                              {request.vehicleId}
                            </span>
                            <Badge className={SEVERITY_STYLE[request.severity].chip}>
                              {SEVERITY_STYLE[request.severity].label}
                            </Badge>
                            <span className="truncate text-[12.5px] text-ink-600">{request.destination.name}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {route && (
                              <span className="tnum font-mono text-[11.5px] text-ink-500">
                                {formatEta(route.etaSeconds)}
                              </span>
                            )}
                            <Badge className={style.chip}>{style.label}</Badge>
                            <time className="tnum font-mono text-[11px] text-ink-400">
                              {formatClock(request.decidedAt ?? request.createdAt)}
                            </time>
                          </div>
                        </div>
                        {request.rejectionReason && (
                          <p className="mt-1 text-[11.5px] text-critical-600">{request.rejectionReason}</p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <Card title="Detail" className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-140px)]" noPadding>
          <DetailPanel vehicleById={vehicleById} />
        </Card>
      </div>
    </ControllerLayout>
  );
}
