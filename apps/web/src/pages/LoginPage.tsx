import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Radio, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

/**
 * Sign-in.
 *
 * Credentials only. The screen shows no accounts, no password hints and no
 * role picker — it cannot, because the API has no endpoint that would supply
 * them. Two consequences of that are deliberate:
 *
 *   - Role is never chosen here. A driver does not become a driver by picking
 *     "ambulance driver" from a list; authority comes from the account record
 *     and from the verified vehicle chain behind it, both resolved server-side.
 *   - A failed sign-in never says whether the address exists. The server
 *     returns one message for both cases, so this form cannot be used to
 *     enumerate which emergency accounts are real.
 */
export function LoginPage() {
  const login = useAuthStore((state) => state.login);
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    clearError();
    try {
      await login(email.trim(), password);
    } catch {
      // The store holds the message; the form stays put so it can be re-tried.
    }
  };

  const busy = status === 'authenticating';

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[380px]">
        {/* Identity */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-brand-600 shadow-sm">
            <Radio className="size-6 text-white" />
          </div>
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink-900">SMART-ER</h1>
          <p className="text-[13px] text-ink-500">Emergency Traffic System</p>
        </div>

        <div className="rounded-xl border border-line bg-surface p-6 shadow-card">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-ink-700">
                Email or employee ID
              </label>
              <input
                id="email"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
                className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-ink-700">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                  className="h-10 w-full rounded-lg border border-line bg-surface px-3 pr-10 text-sm text-ink-900 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-400 transition-colors hover:text-ink-600"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-critical-200 bg-critical-50 px-3 py-2 text-[13px] text-critical-700"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="h-10 w-full rounded-lg bg-brand-600 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            <div className="text-center">
              <Link to="/forgot-password" className="text-[13px] text-brand-600 hover:underline">
                Forgot password?
              </Link>
            </div>
          </form>
        </div>

        <p className="mt-5 flex items-start justify-center gap-1.5 px-2 text-center text-[11px] leading-relaxed text-ink-400">
          <ShieldCheck className="mt-px size-3.5 shrink-0" />
          <span>
            Emergency privileges are granted by your account and the verified vehicle assigned to it. Access is
            logged.
          </span>
        </p>
      </div>
    </div>
  );
}
