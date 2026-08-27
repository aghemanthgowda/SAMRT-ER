import { LogOut, Radio, Wifi, WifiOff } from 'lucide-react';
import { formatClock } from '@smart-er/core';
import { useNow } from '@/hooks/useNow';
import { useAuthStore } from '@/stores/authStore';
import { useOpsStore } from '@/stores/opsStore';
import type { ReactNode } from 'react';

/**
 * Header for the destination dashboards.
 *
 * Hospital, fire and police consoles are simpler than the controller's and do
 * not need a navigation column, so they carry a single bar with the four
 * things an operator must be able to see without looking for them: who they
 * are signed in as, whether the data is live, the time, and a way out.
 */
export function TopBar({ subtitle, children }: { subtitle?: string; children?: ReactNode }) {
  const now = useNow();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const connection = useOpsStore((state) => state.connection);

  const link: Record<string, { className: string; label: string; live: boolean }> = {
    live: { className: 'text-ok-600', label: 'Live', live: true },
    connecting: { className: 'text-ink-400', label: 'Connecting', live: false },
    reconnecting: { className: 'text-warn-600', label: 'Reconnecting', live: false },
    offline: { className: 'text-critical-600', label: 'Disconnected', live: false },
  };
  const state = link[connection] ?? link.offline!;

  return (
    <header className="flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600">
          <Radio className="size-[18px] text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-ink-900">SMART-ER</h1>
          {subtitle && <p className="truncate text-[11.5px] leading-tight text-ink-500">{subtitle}</p>}
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2">{children}</div>

      <div className="flex shrink-0 items-center gap-3">
        <div className={`flex items-center gap-1.5 ${state.className}`} title={`Realtime link: ${state.label}`}>
          {state.live ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
          <span className="hidden text-[12px] font-medium sm:inline">{state.label}</span>
        </div>

        <time className="tnum hidden font-mono text-[13px] text-ink-700 sm:block" dateTime={now.toISOString()}>
          {formatClock(now)}
        </time>

        <div className="hidden items-center border-l border-line pl-3 md:flex">
          <div className="text-right">
            <p className="text-[12.5px] font-medium leading-tight text-ink-800">
              {user?.callSign ?? user?.displayName}
            </p>
            <p className="text-[11px] leading-tight text-ink-500">{user?.role.replace('_', ' ')}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={logout}
          title="Sign out"
          className="flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-ink-500 transition-colors hover:bg-surface-muted hover:text-ink-800"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </header>
  );
}
