import { LogOut, Radio, Wifi, WifiOff } from 'lucide-react';
import { formatClock } from '@smart-er/core';
import { useNow } from '@/hooks/useNow';
import { useAuthStore } from '@/stores/authStore';
import { useOpsStore } from '@/stores/opsStore';
import type { ReactNode } from 'react';

/**
 * The console header.
 *
 * Carries the four things an operator must be able to see without looking for
 * them: who they are signed in as, whether the data in front of them is live,
 * the time, and a way out. Connection state is not a subtle indicator — a
 * dashboard showing stale positions is actively dangerous, so a dropped link
 * is stated in words.
 */
export function TopBar({ subtitle, children }: { subtitle?: string; children?: ReactNode }) {
  const now = useNow();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const connection = useOpsStore((state) => state.connection);

  const connectionStyles: Record<string, { className: string; label: string; live: boolean }> = {
    live: { className: 'text-status-ok', label: 'Live', live: true },
    connecting: { className: 'text-ground-400', label: 'Connecting', live: false },
    reconnecting: { className: 'text-status-high', label: 'Reconnecting', live: false },
    offline: { className: 'text-status-critical', label: 'Disconnected', live: false },
  };
  const link = connectionStyles[connection] ?? connectionStyles.offline!;

  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-ground-700 bg-ground-900 px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-[3px] bg-accent-500">
          <Radio className="size-3.5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[13px] font-semibold leading-tight tracking-tight text-ground-50">SMART-ER</h1>
          {subtitle && <p className="truncate text-[10px] leading-tight text-ground-400">{subtitle}</p>}
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2">{children}</div>

      <div className="flex shrink-0 items-center gap-3">
        <div className={`flex items-center gap-1.5 ${link.className}`} title={`Realtime link: ${link.label}`}>
          {link.live ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
          <span className="hidden text-[11px] font-medium sm:inline">{link.label}</span>
        </div>

        <time className="tnum hidden font-mono text-xs text-ground-200 sm:block" dateTime={now.toISOString()}>
          {formatClock(now)}
        </time>

        <div className="hidden items-center gap-2 border-l border-ground-700 pl-3 md:flex">
          <div className="text-right">
            <p className="text-[11px] font-medium leading-tight text-ground-100">
              {user?.callSign ?? user?.displayName}
            </p>
            <p className="text-[10px] leading-tight text-ground-400">{user?.role.replace('_', ' ')}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={logout}
          title="Sign out"
          className="flex size-7 items-center justify-center rounded-[3px] border border-ground-600 bg-ground-850 text-ground-300 transition-colors hover:bg-ground-800 hover:text-ground-100"
        >
          <LogOut className="size-3.5" />
        </button>
      </div>
    </header>
  );
}
