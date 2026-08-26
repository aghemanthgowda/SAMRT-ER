import { Flame, ShieldAlert, Siren, TriangleAlert } from 'lucide-react';
import { IncidentKind, IncidentStatus, formatClock } from '@smart-er/core';
import { Badge, Empty } from '@/components/ui/primitives';
import { SEVERITY_STYLE } from '@/lib/status';
import { useOpsStore, useOpenIncidents } from '@/stores/opsStore';

const KIND_ICON = {
  [IncidentKind.FIRE]: Flame,
  [IncidentKind.MEDICAL]: Siren,
  [IncidentKind.LAW_ENFORCEMENT]: ShieldAlert,
  [IncidentKind.ROAD_ACCIDENT]: TriangleAlert,
} as const;

const STATUS_LABEL: Record<IncidentStatus, string> = {
  [IncidentStatus.REPORTED]: 'Reported',
  [IncidentStatus.DISPATCHED]: 'Dispatched',
  [IncidentStatus.ON_SCENE]: 'On scene',
  [IncidentStatus.RESOLVED]: 'Resolved',
};

/** Open incidents across all services, newest first. */
export function IncidentQueue() {
  const incidents = useOpenIncidents();
  const selection = useOpsStore((state) => state.selection);
  const select = useOpsStore((state) => state.select);

  if (incidents.length === 0) {
    return <Empty message="No open incidents" hint="Reported incidents from fire and police appear here." />;
  }

  return (
    <div>
      {incidents.map((incident) => {
        const Icon = KIND_ICON[incident.kind] ?? TriangleAlert;
        const severity = SEVERITY_STYLE[incident.severity];
        const selected = selection?.kind === 'incident' && selection.id === incident.id;

        return (
          <button
            key={incident.id}
            type="button"
            data-selected={selected}
            onClick={() => select({ kind: 'incident', id: incident.id })}
            className="row-button px-2.5 py-2"
          >
            <div className="flex items-start gap-1.5">
              <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: severity.hex }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="tnum font-mono text-[11px] font-semibold text-ground-50">{incident.code}</span>
                  <Badge className={severity.chip}>{severity.label}</Badge>
                </div>
                <p className="truncate text-[11px] text-ground-300">{incident.address}</p>
                <p className="tnum font-mono text-[10px] text-ground-500">
                  {formatClock(incident.reportedAt)} · {STATUS_LABEL[incident.status]}
                  {incident.assignedVehicleIds.length > 0 && ` · ${incident.assignedVehicleIds.join(', ')}`}
                </p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
