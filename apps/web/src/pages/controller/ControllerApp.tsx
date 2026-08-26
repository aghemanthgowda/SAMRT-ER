import { useState } from 'react';
import { Activity, Bell, LayoutGrid, ListTree, Radio, ShieldAlert, Waypoints } from 'lucide-react';
import { Panel } from '@/components/ui/primitives';
import { ActiveVehicles } from '@/components/panels/ActiveVehicles';
import { ConflictMonitor } from '@/components/panels/ConflictMonitor';
import { DetailPanel } from '@/components/panels/DetailPanel';
import { HardwareStatus } from '@/components/panels/HardwareStatus';
import { IncidentTimeline } from '@/components/panels/IncidentTimeline';
import { IncidentQueue } from '@/components/panels/IncidentQueue';
import { JunctionNetwork } from '@/components/panels/JunctionNetwork';
import { PublicImpact } from '@/components/panels/PublicImpact';
import { RequestQueue } from '@/components/panels/RequestQueue';
import { SimulationControl } from '@/components/panels/SimulationControl';
import { TopBar } from '@/components/shell/TopBar';
import { useRealtime } from '@/hooks/useRealtime';
import { useVehicleIndex } from '@/hooks/useVehicleIndex';
import { OperationsMap } from '@/maps/OperationsMap';
import { useOpsStore, usePendingRequests } from '@/stores/opsStore';

/**
 * The controller console.
 *
 * Desktop-first, laid out as an operations product rather than a dashboard:
 *
 *   top     identity, link state, clock
 *   left    the decision queue — requests awaiting approval, then incidents
 *   centre  the map, dominant, because geography is the primary display
 *   right   active units, then contextual detail for whatever is selected
 *   bottom  the network: junctions, conflicts, hardware, timeline, impact
 *
 * The map is given the most space deliberately. Everything else is a list that
 * can be scanned; the map is the only view that answers "where is everything
 * right now", and shrinking it to make room for more cards would be the wrong
 * trade every time.
 *
 * Below `xl` the three columns stack, and the bottom row becomes a tab strip —
 * a controller on a tablet still needs all of it, just not simultaneously.
 */

type BottomTab = 'junctions' | 'conflicts' | 'hardware' | 'timeline' | 'simulation';

export function ControllerApp() {
  useRealtime();
  const { vehicleById } = useVehicleIndex();

  const pending = usePendingRequests();
  const loaded = useOpsStore((state) => state.loaded);

  const [bottomTab, setBottomTab] = useState<BottomTab>('junctions');

  // A count is a primitive, so this selector is stable across store updates
  // without needing a shallow comparison.
  const openConflicts = useOpsStore(
    (state) =>
      Object.values(state.conflicts).filter(
        (conflict) => conflict.status === 'DETECTED' || conflict.status === 'UNRESOLVED',
      ).length,
  );

  const tabs: { id: BottomTab; label: string; icon: typeof LayoutGrid; badge?: number }[] = [
    { id: 'junctions', label: 'Junction network', icon: Waypoints },
    { id: 'conflicts', label: 'Conflict monitor', icon: ShieldAlert, badge: openConflicts },
    { id: 'hardware', label: 'Hardware', icon: Radio },
    { id: 'timeline', label: 'Event timeline', icon: ListTree },
    { id: 'simulation', label: 'Simulation', icon: Activity },
  ];

  return (
    <div className="flex h-full flex-col bg-ground-950">
      <TopBar subtitle="Traffic Control — Central Bengaluru">
        <StatusStrip pendingCount={pending.length} conflictCount={openConflicts} />
      </TopBar>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-1.5 p-1.5 xl:grid-cols-[minmax(260px,300px)_minmax(0,1fr)_minmax(280px,340px)]">
        {/* Left — the decision queue */}
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-1.5 xl:max-h-full">
          <Panel
            title={
              <h2 className="panel-title flex items-center gap-1.5">
                Emergency requests
                {pending.length > 0 && (
                  <span className="tnum rounded-full bg-status-high px-1.5 font-mono text-[10px] font-bold text-ground-950">
                    {pending.length}
                  </span>
                )}
              </h2>
            }
          >
            <RequestQueue vehicleById={vehicleById} />
          </Panel>

          <Panel title="Incidents">
            <IncidentQueue />
          </Panel>
        </div>

        {/* Centre — the map */}
        <Panel
          className="min-h-[340px] xl:min-h-0"
          title="Live operations map"
          bodyClassName="relative overflow-hidden"
        >
          <OperationsMap vehicleById={vehicleById} className="absolute inset-0" />
        </Panel>

        {/* Right — units and contextual detail */}
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1.15fr)] gap-1.5">
          <Panel title="Active units">
            <ActiveVehicles vehicleById={vehicleById} />
          </Panel>
          <Panel title="Detail">
            <DetailPanel vehicleById={vehicleById} />
          </Panel>
        </div>
      </div>

      {/* Bottom — the network */}
      <div className="shrink-0 border-t border-ground-700 bg-ground-900">
        <div className="flex items-stretch overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = bottomTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setBottomTab(tab.id)}
                aria-current={active}
                className={`flex shrink-0 items-center gap-1.5 border-r border-ground-800 px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-ground-850 text-ground-50 shadow-[inset_0_2px_0_var(--color-accent-500)]'
                    : 'text-ground-400 hover:bg-ground-850 hover:text-ground-200'
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="tnum rounded-full bg-status-critical px-1.5 font-mono text-[10px] font-bold text-ground-950">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}

          <div className="ml-auto flex shrink-0 items-center border-l border-ground-800 px-3">
            <div className="w-[230px]">
              <PublicImpact />
            </div>
          </div>
        </div>

        <div className="h-[188px] overflow-hidden border-t border-ground-800">
          {!loaded ? (
            <div className="flex h-full items-center justify-center text-[11px] text-ground-500">
              Waiting for the first operational snapshot…
            </div>
          ) : (
            <>
              {bottomTab === 'junctions' && (
                <div className="h-full overflow-y-auto">
                  <JunctionNetwork />
                </div>
              )}
              {bottomTab === 'conflicts' && (
                <div className="h-full overflow-y-auto">
                  <ConflictMonitor />
                </div>
              )}
              {bottomTab === 'hardware' && (
                <div className="h-full overflow-y-auto">
                  <HardwareStatus />
                </div>
              )}
              {bottomTab === 'timeline' && <IncidentTimeline />}
              {bottomTab === 'simulation' && (
                <div className="h-full overflow-y-auto">
                  <SimulationControl />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact counters in the header — the two numbers that mean "act now". */
function StatusStrip({ pendingCount, conflictCount }: { pendingCount: number; conflictCount: number }) {
  const impact = useOpsStore((state) => state.impact);

  return (
    <div className="hidden items-center gap-3 lg:flex">
      <Counter
        icon={<Bell className="size-3" />}
        label="Pending"
        value={pendingCount}
        tone={pendingCount > 0 ? 'text-status-high' : 'text-ground-400'}
      />
      <Counter
        icon={<ShieldAlert className="size-3" />}
        label="Conflicts"
        value={conflictCount}
        tone={conflictCount > 0 ? 'text-status-critical' : 'text-ground-400'}
      />
      <Counter
        icon={<Waypoints className="size-3" />}
        label="Junctions held"
        value={`${impact?.activeEmergencyJunctions ?? 0}/${impact?.totalJunctions ?? 0}`}
        tone="text-ground-300"
      />
    </div>
  );
}

function Counter({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <span className={tone}>{icon}</span>
      <span className="text-[10px] uppercase tracking-wider text-ground-500">{label}</span>
      <span className={`tnum font-mono text-xs font-semibold ${tone}`}>{value}</span>
    </div>
  );
}
