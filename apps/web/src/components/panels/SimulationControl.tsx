import { useEffect, useState } from 'react';
import { Gauge, Play, RotateCcw, Square } from 'lucide-react';
import type { SimulationScenario } from '@smart-er/core';
import { api } from '@/api/client';
import { Button, Spinner } from '@/components/ui/primitives';
import { useOpsStore } from '@/stores/opsStore';

/**
 * Simulation control.
 *
 * Phase 1 has no physical hardware, so this is how a demonstration is driven.
 * Each scenario states what it is meant to show, so the operator running the
 * demo knows what to point at rather than narrating whatever happens.
 */
export function SimulationControl() {
  const simulation = useOpsStore((state) => state.simulation);
  const [scenarios, setScenarios] = useState<SimulationScenario[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api
      .simulation()
      .then((result) => setScenarios(result.scenarios))
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, []);

  const guard = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="Loading scenarios" />;

  const running = simulation?.scenarioId;

  return (
    <div className="space-y-2 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Gauge className="size-3.5 text-ground-400" />
          <span className="tnum font-mono text-[11px] text-ground-200">
            {simulation?.running ? 'Running' : 'Paused'} · {simulation?.speed ?? 1}×
          </span>
        </div>
        <div className="flex items-center gap-1">
          {[1, 2, 4].map((speed) => (
            <button
              key={speed}
              type="button"
              disabled={busy}
              onClick={() => void guard(() => api.setSimulationSpeed(speed))}
              className={`h-5 rounded-[3px] border px-1.5 text-[10px] font-medium transition-colors ${
                simulation?.speed === speed
                  ? 'border-accent-500 bg-accent-500/20 text-accent-400'
                  : 'border-ground-600 bg-ground-850 text-ground-300 hover:bg-ground-800'
              }`}
            >
              {speed}×
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-[3px] border border-status-critical/40 bg-status-critical-dim px-2 py-1 text-[10px] text-status-critical">
          {error}
        </p>
      )}

      {running && (
        <div className="rounded-[3px] border border-accent-500/40 bg-accent-500/10 px-2 py-1.5">
          <p className="text-[11px] font-medium text-accent-400">{simulation?.scenarioName}</p>
          <p className="tnum font-mono text-[10px] text-ground-400">
            t+{Math.round(simulation?.elapsedSeconds ?? 0)}s · step {simulation?.stepIndex ?? 0}
          </p>
        </div>
      )}

      <div className="space-y-1">
        {scenarios.map((scenario) => {
          const active = simulation?.scenarioId === scenario.id;
          return (
            <div
              key={scenario.id}
              className={`rounded-[3px] border px-2 py-1.5 ${
                active ? 'border-accent-500/50 bg-ground-800' : 'border-ground-700 bg-ground-850'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-ground-100">{scenario.name}</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-ground-400">{scenario.description}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-ground-500">
                    <span className="font-medium text-ground-400">Watch for: </span>
                    {scenario.expectedOutcome}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={active ? 'default' : 'primary'}
                  disabled={busy}
                  onClick={() => void guard(() => api.startScenario(scenario.id))}
                >
                  <Play className="size-3" />
                  {active ? 'Restart' : 'Start'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-1.5 border-t border-ground-800 pt-2">
        <Button size="sm" disabled={busy} onClick={() => void guard(() => api.stopScenario())} className="flex-1">
          <Square className="size-3" />
          Stop
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={() => void guard(() => api.resetSimulation())}
          className="flex-1"
          title="Release every corridor, cancel open requests and clear traffic"
        >
          <RotateCcw className="size-3" />
          Reset
        </Button>
      </div>
    </div>
  );
}
