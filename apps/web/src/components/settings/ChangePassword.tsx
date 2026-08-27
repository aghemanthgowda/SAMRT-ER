import { useState, type FormEvent } from 'react';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { api } from '@/api/client';

/**
 * Change your own password.
 *
 * The current password is required even though the form is behind a session:
 * a console left unlocked should not be enough for someone to take the account
 * away from the person who owns it. The server enforces this too — the field
 * is here because the check exists, not the other way round.
 */
export function ChangePassword({ minLength = 12 }: { minLength?: number }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const mismatched = confirmation.length > 0 && confirmation !== next;
  const submittable = current.length > 0 && next.length >= minLength && next === confirmation && !busy;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setDone(false);
    try {
      await api.changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirmation('');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field =
    'h-9 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink-900 outline-none ' +
    'transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60';

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div>
        <label htmlFor="current-password" className="mb-1 block text-[12.5px] font-medium text-ink-700">
          Current password
        </label>
        <input
          id="current-password"
          name="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          disabled={busy}
          className={field}
        />
      </div>

      <div>
        <label htmlFor="next-password" className="mb-1 block text-[12.5px] font-medium text-ink-700">
          New password
        </label>
        <div className="relative">
          <input
            id="next-password"
            name="new-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            disabled={busy}
            className={`${field} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShow((value) => !value)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-400 transition-colors hover:text-ink-600"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <p className="mt-1 text-[11.5px] text-ink-500">At least {minLength} characters.</p>
      </div>

      <div>
        <label htmlFor="confirm-new-password" className="mb-1 block text-[12.5px] font-medium text-ink-700">
          Confirm new password
        </label>
        <input
          id="confirm-new-password"
          name="confirm-password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          disabled={busy}
          className={field}
        />
        {mismatched && <p className="mt-1 text-[11.5px] text-critical-600">Both fields must match.</p>}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-critical-200 bg-critical-50 px-3 py-2 text-[12.5px] text-critical-700"
        >
          {error}
        </p>
      )}

      {done && (
        <p
          role="status"
          className="flex items-center gap-1.5 rounded-lg border border-ok-200 bg-ok-50 px-3 py-2 text-[12.5px] text-ok-700"
        >
          <CheckCircle2 className="size-3.5 shrink-0" />
          Password changed. Your current session stays signed in.
        </p>
      )}

      <button
        type="submit"
        disabled={!submittable}
        className="h-9 rounded-lg bg-brand-600 px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Changing…' : 'Change password'}
      </button>
    </form>
  );
}
