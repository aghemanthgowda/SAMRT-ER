import { NavLink } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  LayoutDashboard,
  LogOut,
  Map,
  Radio,
  Settings,
  Siren,
  Truck,
  Waypoints,
  X,
} from 'lucide-react';
import { formatClock } from '@smart-er/core';
import { useNow } from '@/hooks/useNow';
import { useAuthStore } from '@/stores/authStore';
import { useOpsStore, usePendingRequests } from '@/stores/opsStore';

/**
 * Controller navigation.
 *
 * Dark navy against the light canvas, so the working area is unambiguous —
 * the operator's eye goes to the map, not to the chrome. The current page is
 * the only blue element in the column.
 *
 * The profile block reads from the authenticated session; nothing about the
 * signed-in operator is hard-coded, because the same shell serves whoever is
 * on shift.
 */

const NAV = [
  { to: '/controller', end: true, label: 'Dashboard', icon: LayoutDashboard },
  { to: '/controller/map', label: 'Live Map', icon: Map },
  { to: '/controller/requests', label: 'Requests', icon: Siren, badge: 'requests' as const },
  { to: '/controller/vehicles', label: 'Vehicles', icon: Truck },
  { to: '/controller/junctions', label: 'Junctions', icon: Waypoints },
  { to: '/controller/incidents', label: 'Incidents', icon: AlertTriangle },
  { to: '/controller/alerts', label: 'Alerts', icon: Bell },
  { to: '/controller/reports', label: 'Reports', icon: BarChart3 },
  { to: '/controller/settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose(): void }) {
  const now = useNow();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const connection = useOpsStore((state) => state.connection);
  const pending = usePendingRequests();

  const online = connection === 'live';

  return (
    <>
      {/* Mobile scrim */}
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-ink-900/40 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[228px] shrink-0 flex-col bg-navy-900 transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand */}
        <div className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-navy-700 px-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600">
            <Radio className="size-[18px] text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight tracking-tight text-white">SMART-ER</p>
            <p className="truncate text-[10.5px] leading-tight text-navy-400">Emergency Traffic System</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="text-navy-400 transition-colors hover:text-white lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <ul className="space-y-0.5">
            {NAV.map((item) => {
              const Icon = item.icon;
              const count = item.badge === 'requests' ? pending.length : 0;
              return (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end} onClick={onClose} className="nav-item">
                    <Icon className="size-[17px] shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {count > 0 && (
                      <span className="tnum flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-critical-500 px-1 font-mono text-[10px] font-semibold text-white">
                        {count}
                      </span>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Clock */}
        <div className="shrink-0 border-t border-navy-700 px-4 py-3">
          <p className="tnum font-mono text-[19px] font-semibold leading-none text-white">{formatClock(now)}</p>
          <p className="mt-1 text-[11px] text-navy-400">
            {now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>

        {/* Operator */}
        <div className="shrink-0 border-t border-navy-700 p-3">
          <div className="flex items-center gap-2.5 px-1">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-navy-700 text-[13px] font-semibold text-navy-200">
              {initials(user?.callSign ?? user?.displayName ?? '?')}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-tight text-white">
                {user?.callSign ?? user?.displayName}
              </p>
              <p className="truncate text-[11px] leading-tight text-navy-400">{roleLabel(user?.role)}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[10.5px] leading-tight">
                <span className={`size-1.5 rounded-full ${online ? 'bg-ok-500' : 'bg-critical-500'}`} aria-hidden />
                <span className={online ? 'text-ok-500' : 'text-critical-500'}>
                  {online ? 'Online' : 'Disconnected'}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={logout}
            className="mt-2.5 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-navy-600 text-[13px] font-medium text-navy-200 transition-colors hover:bg-navy-700 hover:text-white"
          >
            <LogOut className="size-4" />
            Log out
          </button>
        </div>
      </aside>
    </>
  );
}

function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 -]/g, ' ').trim().split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function roleLabel(role?: string): string {
  if (!role) return '';
  return role
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}
