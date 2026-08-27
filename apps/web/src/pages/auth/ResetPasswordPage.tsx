import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { api } from '@/api/client';
import { AuthShell, FormError, fieldClass, submitClass } from './AuthShell';

/**
 * Complete a recovery.
 *
 * The token arrives in the query string, is submitted once, and is never shown
 * or stored. The server decides whether it is valid; the length check here is
 * only so an obviously short password costs a round trip rather than a
 * rejection, and it reads the requirement from the API rather than restating
 * a number that could drift out of step with the one actually enforced.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [minLength, setMinLength] = useState(12);

  useEffect(() => {
    let cancelled = false;
    void api
      .passwordPolicy()
      .then((policy) => {
        if (!cancelled) setMinLength(policy.minLength);
      })
      .catch(() => {
        // Keep the default; the server enforces the real rule either way.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tooShort = password.length > 0 && password.length < minLength;
  const mismatched = confirmation.length > 0 && confirmation !== password;
  const submittable = password.length >= minLength && confirmation === password && !busy;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title="Link not valid">
        <div className="space-y-4 text-center">
          <p className="text-[13px] leading-relaxed text-ink-600">
            This page needs a recovery link. Request a new one and use the link exactly as it was sent.
          </p>
          <Link to="/forgot-password" className="inline-block text-[13px] font-medium text-brand-600 hover:underline">
            Request a recovery link
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password changed">
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto size-8 text-ok-600" aria-hidden />
          <p className="text-[13px] text-ink-600">Sign in with your new password.</p>
          <Link to="/login" className="inline-block text-[13px] font-medium text-brand-600 hover:underline">
            Go to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-ink-700">
            New password
          </label>
          <div className="relative">
            <input
              id="password"
              name="new-password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              aria-describedby="password-hint"
              className={`${fieldClass} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShow((current) => !current)}
              aria-label={show ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-400 transition-colors hover:text-ink-600"
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <p id="password-hint" className={`mt-1.5 text-[12px] ${tooShort ? 'text-critical-600' : 'text-ink-500'}`}>
            At least {minLength} characters. A short phrase you can remember beats a short jumble you cannot.
          </p>
        </div>

        <div>
          <label htmlFor="confirmation" className="mb-1.5 block text-[13px] font-medium text-ink-700">
            Confirm new password
          </label>
          <input
            id="confirmation"
            name="confirm-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={busy}
            className={fieldClass}
          />
          {mismatched && <p className="mt-1.5 text-[12px] text-critical-600">Both fields must match.</p>}
        </div>

        {error && <FormError message={error} />}

        <button type="submit" disabled={!submittable} className={submitClass}>
          {busy ? 'Saving…' : 'Set new password'}
        </button>

        <div className="text-center">
          <Link to="/login" className="text-[13px] text-brand-600 hover:underline">
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
