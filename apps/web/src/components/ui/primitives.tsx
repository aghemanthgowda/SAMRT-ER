import clsx from 'clsx';
import type { ReactNode } from 'react';

/**
 * Console primitives.
 *
 * Small and deliberately plain. The visual identity of this product comes from
 * consistent spacing and status colour, not from component decoration — these
 * mostly exist to stop twenty screens each inventing their own idea of what a
 * card or a badge looks like.
 */

export function Card({
  title,
  actions,
  children,
  className,
  bodyClassName,
  footer,
  noPadding,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
  /** Lists and maps manage their own padding. */
  noPadding?: boolean;
}) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="card-header">
          {typeof title === 'string' ? <h2 className="card-title">{title}</h2> : title}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx('card-body', !noPadding && 'p-4', bodyClassName)}>{children}</div>
      {footer && <footer className="border-t border-line px-4 py-2.5">{footer}</footer>}
    </section>
  );
}

/** Kept as an alias so existing panels do not all have to be renamed at once. */
export const Panel = Card;

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
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</div>
      <div className={clsx('truncate text-[13px] text-ink-800', mono && 'tnum font-mono')}>{value}</div>
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
    default: 'bg-surface text-ink-700 border-line hover:bg-surface-muted',
    primary: 'bg-brand-600 text-white border-brand-600 hover:bg-brand-700',
    danger: 'bg-critical-50 text-critical-700 border-critical-200 hover:bg-critical-100',
    success: 'bg-ok-50 text-ok-700 border-ok-200 hover:bg-ok-100',
    ghost: 'bg-transparent text-ink-500 border-transparent hover:bg-surface-muted hover:text-ink-800',
  };
  const sizes: Record<string, string> = {
    sm: 'h-7 px-2.5 text-[12px]',
    md: 'h-9 px-3.5 text-[13px]',
    // Large is for the driver handset, where the target must be thumb-sized.
    lg: 'h-12 px-4 text-[15px]',
  };

  return (
    <button
      type="button"
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
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
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center">
      {icon && <div className="text-ink-300">{icon}</div>}
      <p className="text-[13px] font-medium text-ink-600">{message}</p>
      {hint && <p className="max-w-[38ch] text-[12px] leading-relaxed text-ink-400">{hint}</p>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-8 text-[13px] text-ink-500" role="status">
      <span
        className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-brand-600"
        aria-hidden
      />
      {label ?? 'Loading'}
    </div>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="m-3 rounded-lg border border-critical-200 bg-critical-50 px-3 py-2.5">
      <p className="text-[13px] text-critical-700">{message}</p>
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
      className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken', className)}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-line bg-surface-muted px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
      {children}
    </div>
  );
}

/**
 * A small status dot with a label — the System Status panel's unit, and used
 * anywhere a service's health needs stating without a full badge.
 */
export function StatusDot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span className="relative flex size-2">
      {pulse && (
        <span
          className="absolute inline-flex size-full animate-ping rounded-full opacity-60"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      <span className="relative inline-flex size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
    </span>
  );
}

/** "View all" style link used on every dashboard card header. */
export function CardLink({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[12.5px] font-medium text-brand-600 transition-colors hover:text-brand-700"
    >
      {children}
    </button>
  );
}
