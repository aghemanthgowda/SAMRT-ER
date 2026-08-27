import { useState, type ReactNode } from 'react';
import { Bell, Maximize2, Menu, Minimize2, Wifi, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useOpsStore } from '@/stores/opsStore';

/**
 * The page header.
 *
 * Deliberately thin: the page title, and the three things an operator must be
 * able to check without hunting — unread alerts, whether the data in front of
 * them is live, and a way to go full screen for a wall display.
 *
 * Connection state is stated in words on hover and in colour at a glance. A
 * dashboard quietly showing stale vehicle positions is worse than one that
 * visibly says it has lost its link.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  onOpenNav,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  onOpenNav(): void;
}) {
  const navigate = useNavigate();
  const connection = useOpsStore((state) => state.connection);
  const notifications = useOpsStore((state) => state.notifications);
  const [fullscreen, setFullscreen] = useState(false);

  const unread = notifications.filter((notification) => !notification.readAt).length;
  const online = connection === 'live';

  const toggleFullscreen = () => {
    // Not available in every browser or embedding context; failing silently is
    // correct here — it is a convenience, not a control.
    const target = document.documentElement;
    if (!document.fullscreenElement) {
      void target.requestFullscreen?.().then(() => setFullscreen(true)).catch(() => undefined);
    } else {
      void document.exitFullscreen?.().then(() => setFullscreen(false)).catch(() => undefined);
    }
  };

  const linkLabel =
    connection === 'live'
      ? 'Live'
      : connection === 'reconnecting'
        ? 'Reconnecting'
        : connection === 'connecting'
          ? 'Connecting'
          : 'Disconnected';

  return (
    <header className="flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open navigation"
          className="flex size-9 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-surface-muted lg:hidden"
        >
          <Menu className="size-5" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-semibold leading-tight tracking-tight text-ink-900">{title}</h1>
          {subtitle && <p className="truncate text-[12px] leading-tight text-ink-500">{subtitle}</p>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {actions}

        <button
          type="button"
          onClick={() => navigate('/controller/alerts')}
          aria-label={`Alerts${unread > 0 ? ` — ${unread} unread` : ''}`}
          className="relative flex size-9 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-surface-muted"
        >
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="tnum absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-critical-500 px-1 font-mono text-[9px] font-semibold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>

        <span
          title={`Realtime link: ${linkLabel}`}
          className={`flex size-9 items-center justify-center rounded-lg ${
            online ? 'text-ok-600' : 'text-critical-600'
          }`}
        >
          {online ? <Wifi className="size-[18px]" /> : <WifiOff className="size-[18px]" />}
          <span className="sr-only">{linkLabel}</span>
        </span>

        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'}
          className="hidden size-9 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-surface-muted sm:flex"
        >
          {fullscreen ? <Minimize2 className="size-[18px]" /> : <Maximize2 className="size-[18px]" />}
        </button>
      </div>
    </header>
  );
}
