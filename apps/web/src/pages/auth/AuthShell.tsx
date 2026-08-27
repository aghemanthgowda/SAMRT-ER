import type { ReactNode } from 'react';
import { SmartErMark } from '@/components/brand/SmartErMark';

/** The framing the sign-in screen uses, shared with the recovery screens. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <SmartErMark className="size-12 text-brand-700" />
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
          {subtitle && <p className="text-[13px] text-ink-500">{subtitle}</p>}
        </div>

        <div className="rounded-xl border border-line bg-surface p-6 shadow-card">{children}</div>
      </div>
    </div>
  );
}

export const fieldClass =
  'h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink-900 outline-none ' +
  'transition-colors placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 ' +
  'disabled:opacity-60';

export const submitClass =
  'h-10 w-full rounded-lg bg-brand-600 text-sm font-medium text-white transition-colors ' +
  'hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60';

export function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-critical-200 bg-critical-50 px-3 py-2 text-[13px] text-critical-700"
    >
      {message}
    </p>
  );
}
