import { useCallback, useEffect, useState } from 'react';
import type { PublicTrafficImpact, ResponseSample, ServiceStatus } from '@smart-er/core';
import { RequestAbortedError, api, type DashboardHeadline, type OperationalAlert } from '@/api/client';
import { hasApiKey } from '@/maps/loader';
import { useOpsStore } from '@/stores/opsStore';

/**
 * Dashboard summary data.
 *
 * The counters, health rows, alerts and chart are all derived server-side, so
 * they are fetched rather than computed in the browser. They refresh on a slow
 * interval *and* whenever the realtime store reports a change that would move
 * them — a request arriving or a vehicle completing — so the numbers never sit
 * stale behind a live map.
 */
export interface DashboardData {
  headline?: DashboardHeadline;
  systemStatus: ServiceStatus[];
  responseHistory: ResponseSample[];
  impact?: PublicTrafficImpact;
  alerts: OperationalAlert[];
  loading: boolean;
  error?: string;
  refresh(): void;
}

export function useDashboardData(days = 7): DashboardData {
  const [headline, setHeadline] = useState<DashboardHeadline | undefined>();
  const [systemStatus, setSystemStatus] = useState<ServiceStatus[]>([]);
  const [responseHistory, setResponseHistory] = useState<ResponseSample[]>([]);
  const [impact, setImpact] = useState<PublicTrafficImpact | undefined>();
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  // Changing state that should pull fresh figures.
  const requestCount = useOpsStore((state) => Object.keys(state.requests).length);
  const timelineLength = useOpsStore((state) => state.timeline.length);
  const corridorCount = useOpsStore((state) => Object.keys(state.corridors).length);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [dashboard, alertList] = await Promise.all([
        api.dashboard(hasApiKey(), days, signal),
        api.alerts(12, signal),
      ]);
      setHeadline(dashboard.headline);
      setSystemStatus(dashboard.systemStatus);
      setResponseHistory(dashboard.responseHistory);
      setImpact(dashboard.impact);
      setAlerts(alertList);
      setError(undefined);
    } catch (loadError) {
      // A cancelled request is not a failure — the operator navigated away and
      // the answer stopped being needed.
      if (loadError instanceof RequestAbortedError) return;
      // Anything else: the dashboard still renders from realtime state, so this
      // is reported without blanking the screen.
      setError((loadError as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Re-fetch when something meaningful happened, debounced so a burst of
  // timeline events during a corridor run does not cause a request per tick.
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 1200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [requestCount, timelineLength, corridorCount, load]);

  // Slow backstop, for the figures that drift without an event — uptime, and
  // the day rolling over in the response history.
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setInterval(() => void load(controller.signal), 30_000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [load]);

  return { headline, systemStatus, responseHistory, impact, alerts, loading, error, refresh: () => void load() };
}
