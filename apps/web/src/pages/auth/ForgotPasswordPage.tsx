import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { api } from '@/api/client';
import { AuthShell, FormError, fieldClass, submitClass } from './AuthShell';

/**
 * Request a recovery link.
 *
 * The confirmation is deliberately the same whether or not the address has an
 * account. Telling the visitor "no account with that address" would make this
 * page an account-enumeration tool that needs no credentials — the exact thing
 * removing the account list from the sign-in screen was meant to prevent — and
 * the server answers identically in both cases regardless of what is shown.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your inbox">
        <div className="space-y-4 text-center">
          <MailCheck className="mx-auto size-8 text-ok-600" aria-hidden />
          <p className="text-[13px] leading-relaxed text-ink-600">
            If an account exists for <span className="font-medium text-ink-900">{email.trim()}</span>, a recovery link
            is on its way. It expires in 30 minutes.
          </p>
          <p className="text-[12px] text-ink-500">
            Nothing arrived? Check with your administrator — not every address has an operator account.
          </p>
          <Link to="/login" className="inline-block text-[13px] font-medium text-brand-600 hover:underline">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="We'll send a recovery link">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-ink-700">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            className={fieldClass}
          />
        </div>

        {error && <FormError message={error} />}

        <button type="submit" disabled={busy || email.trim().length === 0} className={submitClass}>
          {busy ? 'Sending…' : 'Send recovery link'}
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
