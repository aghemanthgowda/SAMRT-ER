import { useEffect, useState, type FormEvent } from 'react';
import { Radio, ShieldCheck } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/primitives';
import { useAuthStore } from '@/stores/authStore';

interface DemoAccount {
  email: string;
  role: string;
  displayName: string;
  facility?: string;
  vehicles?: string[];
}

/**
 * Sign-in.
 *
 * Role is never chosen here. A driver does not become a driver by picking
 * "ambulance driver" from a list — authority comes from the account, and from
 * the verified chain behind it. The screen only takes credentials.
 */
export function LoginPage() {
  const login = useAuthStore((state) => state.login);
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [demo, setDemo] = useState<{ password: string; accounts: DemoAccount[] } | undefined>();

  useEffect(() => {
    // Present only outside production; a 404 here is expected and harmless.
    void api
      .demoAccounts()
      .then(setDemo)
      .catch(() => undefined);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    clearError();
    try {
      await login(email.trim(), password);
    } catch {
      // The store holds the message; the form stays put so it can be re-tried.
    }
  };

  const fillFromAccount = (account: DemoAccount) => {
    setEmail(account.email);
    setPassword(demo?.password ?? '');
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-ground-950 px-4 py-8">
      <div className="w-full max-w-5xl">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          {/* Sign-in */}
          <div className="panel">
            <div className="border-b border-ground-700 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-[3px] bg-accent-500">
                  <Radio className="size-4 text-white" />
                </div>
                <div>
                  <h1 className="text-base font-semibold tracking-tight text-ground-50">SMART-ER</h1>
                  <p className="text-[11px] text-ground-400">Emergency Traffic System</p>
                </div>
              </div>
            </div>

            <form onSubmit={submit} className="space-y-3 px-5 py-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ground-400">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-9 w-full rounded-[3px] border border-ground-600 bg-ground-850 px-2.5 text-sm text-ground-100 outline-none placeholder:text-ground-500 focus:border-accent-500"
                  placeholder="controller@smart-er.example"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ground-400">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-9 w-full rounded-[3px] border border-ground-600 bg-ground-850 px-2.5 text-sm text-ground-100 outline-none focus:border-accent-500"
                />
              </div>

              {error && (
                <p role="alert" className="rounded-[3px] border border-status-critical/40 bg-status-critical-dim px-2.5 py-1.5 text-[11px] text-status-critical">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                disabled={status === 'authenticating'}
              >
                {status === 'authenticating' ? 'Signing in…' : 'Sign in'}
              </Button>

              <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-relaxed text-ground-500">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                Emergency privileges are granted by your account and the verified vehicle assigned to it, never by
                selecting a role.
              </p>
            </form>
          </div>

          {/* Demonstration accounts */}
          {demo && demo.accounts.length > 0 && (
            <div className="panel">
              <div className="panel-header">
                <h2 className="panel-title">Demonstration accounts</h2>
                <span className="tnum font-mono text-[11px] text-ground-400">password: {demo.password}</span>
              </div>
              <div className="panel-body">
                <div className="grid gap-px bg-ground-800 sm:grid-cols-2">
                  {demo.accounts.map((account) => (
                    <button
                      key={account.email}
                      type="button"
                      onClick={() => fillFromAccount(account)}
                      className="bg-ground-900 px-3 py-2.5 text-left transition-colors hover:bg-ground-850"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-ground-100">{account.displayName}</span>
                        <span className="shrink-0 rounded-[3px] border border-ground-600 bg-ground-800 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-ground-300">
                          {account.role.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-ground-400">{account.email}</p>
                      {account.facility && <p className="truncate text-[10px] text-ground-500">{account.facility}</p>}
                      {account.vehicles && account.vehicles.length > 0 && (
                        <p className="tnum font-mono text-[10px] text-ground-500">{account.vehicles.join(', ')}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
