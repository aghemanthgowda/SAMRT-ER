import clsx from 'clsx';
import type { ReactNode } from 'react';

/**
 * Console primitives.
 *
 * Small, unopinionated and deliberately plain. The visual identity of this
 * product comes from density and consistent status colour, not from component
 * decoration, so these mostly exist to stop twenty screens each inventing
 * their own idea of what a panel or a badge looks like.
 */

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  footer,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
}) {
  return (
    <section className={clsx('panel', className)}>
      {(title || actions) && (
        <header className="panel-header">
          {typeof title === 'string' ? <h2 className="panel-title">{title}</h2> : title}
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={clsx('panel-body', bodyClassName)}>{children}</div>
      {footer && <footer className="border-t border-ground-700 px-2.5 py-1.5">{footer}</footer>}
    </section>
  );
}

export function Badge({
  className,
  children,
  dot,
}: {
  className?: string;
  children: ReactNode;
  /** Leading status dot, for rows where the label alone reads as decoration. */
  dot?: string;
}) {
  return (
    <span className={clsx('pill', className)}>
      {dot && <span className="size-1.5 rounded-full" style={{ backgroundColor: dot }} aria-hidden />}
      {children}
    </span>
  );
}

/**
 * A labelled value. The label is small and quiet; the value is what the
 * operator is actually reading.
 */
export function Field({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx('min-w-0', className)}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-ground-400">{label}</div>
      <div className={clsx('truncate text-ground-100', mono && 'tnum font-mono')}>{value}</div>
    </div>
  );
}

export function Button({
  children,
  variant = 'default',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'success';
  size?: 'sm' | 'md' | 'lg';
}) {
  const variants: Record<string, string> = {
    default: 'bg-ground-750 text-ground-100 border-ground-600 hover:bg-ground-700',
    primary: 'bg-accent-500 text-white border-accent-600 hover:bg-accent-400',
    danger: 'bg-status-critical/15 text-status-critical border-status-critical/40 hover:bg-status-critical/25',
    success: 'bg-status-ok/15 text-status-ok border-status-ok/40 hover:bg-status-ok/25',
    ghost: 'bg-transparent text-ground-300 border-transparent hover:bg-ground-800 hover:text-ground-100',
  };
  const sizes: Record<string, string> = {
    sm: 'h-6 px-2 text-[11px]',
    md: 'h-7 px-2.5 text-xs',
    // Large is for the driver handset, where the target must be thumb-sized.
    lg: 'h-12 px-4 text-sm',
  };

  return (
    <button
      type="button"
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-[3px] border font-medium',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Empty state.
 *
 * Every list in an operations console spends most of its time empty, and "no
 * pending requests" is itself useful information — so empty states say what
 * the panel would show, not just that there is nothing here.
 */
export function Empty({ icon, message, hint }: { icon?: ReactNode; message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
      {icon && <div className="text-ground-600">{icon}</div>}
      <p className="text-xs text-ground-400">{message}</p>
      {hint && <p className="max-w-[36ch] text-[11px] text-ground-500">{hint}</p>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-ground-400" role="status">
      <span
        className="size-3.5 animate-spin rounded-full border-2 border-ground-600 border-t-accent-400"
        aria-hidden
      />
      {label ?? 'Loading'}
    </div>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="m-2 rounded-[3px] border border-status-critical/40 bg-status-critical-dim px-3 py-2"
    >
      <p className="text-xs text-status-critical">{message}</p>
      {onRetry && (
        <Button size="sm" variant="danger" className="mt-2" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** Horizontal meter for a bounded quantity, e.g. share of junctions held. */
export function Meter({
  value,
  max,
  color,
  className,
}: {
  value: number;
  max: number;
  color: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-ground-800', className)}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-ground-800 bg-ground-850/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-ground-400">
      {children}
    </div>
  );
}
