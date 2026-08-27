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
          <Gauge className="size-3.5 text-ink-500" />
          <span className="tnum font-mono text-[11px] text-ink-700">
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
              className={`h-5 rounded-lg border px-1.5 text-[10px] font-medium transition-colors ${
                simulation?.speed === speed
                  ? 'border-brand-500 bg-brand-100 text-brand-600'
                  : 'border-line bg-surface-muted text-ink-600 hover:bg-surface-muted'
              }`}
            >
              {speed}×
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-critical-200 bg-critical-50 px-2 py-1 text-[10px] text-critical-600">
          {error}
        </p>
      )}

      {running && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5">
          <p className="text-[11px] font-medium text-brand-600">{simulation?.scenarioName}</p>
          <p className="tnum font-mono text-[10px] text-ink-500">
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
              className={`rounded-lg border px-2 py-1.5 ${
                active ? 'border-brand-200 bg-surface-sunken' : 'border-line bg-surface-muted'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-ink-800">{scenario.name}</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-ink-500">{scenario.description}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-ink-9000">
                    <span className="font-medium text-ink-500">Watch for: </span>
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

      <div className="flex gap-1.5 border-t border-line pt-2">
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
