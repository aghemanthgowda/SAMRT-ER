import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { SmartErMark, SmartErWordmark } from '@/components/brand/SmartErMark';
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
 *
 * The single sign-on buttons are rendered because the design calls for them
 * and disabled because no identity provider is configured. A button that looks
 * live and does nothing is worse than one that says why it cannot be used.
 */

/** Where the hero artwork is served from. See the note in `HeroPanel`. */
const HERO_IMAGE = '/login-hero.png';

export function LoginPage() {
  const login = useAuthStore((state) => state.login);
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSignUpNote, setShowSignUpNote] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    clearError();
    try {
      await login(email.trim(), password, remember);
    } catch {
      // The store holds the message; the form stays put so it can be re-tried.
    }
  };

  const busy = status === 'authenticating';

  return (
    /*
      Full-bleed: the screen is the layout, not a card floating on one.
      `dvh` rather than `vh` because mobile browsers change the viewport as
      their chrome hides, and `vh` leaves a strip of the page below the fold
      that can never be scrolled to. The height is fixed to the window, so the
      page itself never scrolls and nothing outside the form column can move —
      the error alert and the sign-up note both resolve inside it.
    */
    <div className="grid h-[100dvh] w-full overflow-hidden bg-surface lg:grid-cols-2">
      <HeroPanel />

      {/* Form */}
      <div className="flex items-center justify-center overflow-y-auto px-6 py-10 sm:px-12 lg:px-14">
        <div className="w-full max-w-[400px]">
          {/* Compact identity for narrow screens, where the hero is hidden. */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <SmartErMark className="size-9 text-brand-700" />
            <SmartErWordmark className="text-xl font-bold tracking-tight" />
          </div>

          <h1 className="text-[32px] font-bold leading-tight tracking-tight text-ink-900 sm:text-[38px]">
            Welcome Back
          </h1>
          <p className="mt-1.5 text-[15px] text-ink-500">Sign in to your SMART-ER account</p>

          <form onSubmit={submit} className="mt-7 space-y-5" noValidate>
            <div>
              <label htmlFor="email" className="mb-2 block text-[14px] font-semibold text-ink-800">
                Email
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-ink-400" />
                <input
                  id="email"
                  name="username"
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  placeholder="Enter your email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                  className="h-[54px] w-full rounded-xl border border-line bg-surface pl-12 pr-4 text-[15px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/12 disabled:opacity-60"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-[14px] font-semibold text-ink-800">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-ink-400" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="Enter password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                  className="h-[54px] w-full rounded-xl border border-line bg-surface pl-12 pr-12 text-[15px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/12 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-ink-400 transition-colors hover:text-ink-600"
                >
                  {showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <label htmlFor="remember" className="flex cursor-pointer select-none items-center gap-2.5">
                <input
                  id="remember"
                  name="remember"
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  disabled={busy}
                  className="size-[18px] cursor-pointer rounded border-line-strong text-brand-600 accent-brand-600 focus:ring-2 focus:ring-brand-500/30"
                />
                <span className="text-[14px] text-ink-700">Remember me</span>
              </label>

              <Link to="/forgot-password" className="text-[14px] font-medium text-brand-600 hover:underline">
                Forgot password?
              </Link>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-critical-200 bg-critical-50 px-4 py-3 text-[13.5px] text-critical-700"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="h-[54px] w-full rounded-xl bg-brand-600 text-[16px] font-semibold text-white transition-colors hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          {/* Federated sign-in */}
          <div className="mt-7 flex items-center gap-4">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[13.5px] text-ink-500">or continue with</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <p id="sso-unavailable" className="sr-only">
            Single sign-on is not configured for this deployment. Sign in with your email and password.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <ProviderButton provider="google" />
            <ProviderButton provider="microsoft" />
          </div>

          {/*
            The explanation is a popover, not a block in the flow.
            The form is vertically centred in its column, so expanding this
            inline would push every field up on a click. It opens upward over
            the provider buttons instead, and nothing moves.
          */}
          <div className="relative mt-7">
            {showSignUpNote && (
              <p
                role="status"
                className="absolute inset-x-0 bottom-full z-10 mb-2 rounded-xl border border-line bg-surface px-4 py-3 text-center text-[13px] leading-relaxed text-ink-600 shadow-lg"
              >
                SMART-ER accounts are issued by your organisation&rsquo;s administrator and linked to a verified
                vehicle. There is no self-service sign-up — emergency privileges cannot be granted by the person
                claiming them.
              </p>
            )}

            <p className="text-center text-[14px] text-ink-600">
              Don&rsquo;t have an account?{' '}
              <button
                type="button"
                onClick={() => setShowSignUpNote((current) => !current)}
                aria-expanded={showSignUpNote}
                className="font-semibold text-brand-600 hover:underline"
              >
                Sign up
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The artwork panel.
 *
 * The image is served from `public/`, not imported, so a missing file is a 404
 * at runtime rather than a build failure — and the branded panel below shows in
 * its place. Drop the artwork at `apps/web/public/login-hero.png` to use it.
 *
 * The artwork is landscape and this panel is a full-height half of the window,
 * which is markedly portrait. `cover` would have to discard a third of the
 * width — and the artwork carries its own logo on the left and an air ambulance
 * on the right, so there is no crop that keeps both.
 *
 * So the image is *contained*: the whole composition is shown, sharp, nothing
 * cut. What would otherwise be empty bands above and below it is filled by the
 * same image, scaled up and blurred out of focus. Because it is the same
 * picture, the blur under the top band is its sky and the blur under the
 * bottom band is its road — the panel fills edge to edge and the seam does not
 * read as one. The browser fetches the file once and paints it twice.
 */
function HeroPanel() {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative hidden overflow-hidden bg-gradient-to-b from-brand-50 via-surface to-surface-sunken lg:block">
      {!failed && (
        <>
          {/* Out-of-focus fill. Decorative: the sharp copy below carries the
              description, and announcing the same image twice is noise. */}
          <img
            src={HERO_IMAGE}
            alt=""
            aria-hidden
            className={`absolute inset-0 size-full scale-110 object-cover blur-2xl transition-opacity duration-500 ${
              loaded ? 'opacity-70' : 'opacity-0'
            }`}
          />
          <img
            src={HERO_IMAGE}
            alt="An ambulance and a fire appliance running a green corridor through city traffic, with an air ambulance overhead"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`absolute inset-0 size-full object-contain object-center transition-opacity duration-500 ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </>
      )}

      {/*
        The artwork carries its own branding, so this is shown only until it
        arrives — or instead of it, if it was never added. Either way the panel
        is never an empty rectangle.
      */}
      {!loaded && (
        <div className="relative flex size-full flex-col p-12">
          <div className="flex items-center gap-3.5">
            <SmartErMark className="size-12 text-brand-700" />
            <div>
              <SmartErWordmark className="block text-[34px] font-bold leading-none tracking-tight" />
              <span className="mt-1.5 block text-[15px] text-ink-500">Emergency Traffic System</span>
            </div>
          </div>

          <p className="mt-9 text-[26px] font-bold leading-tight text-ink-900">Smarter Routes.</p>
          <p className="text-[26px] leading-tight text-ink-800">Faster Response. Saving Lives.</p>
        </div>
      )}
    </div>
  );
}

const PROVIDERS = {
  google: {
    label: 'Google',
    icon: (
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden focusable="false">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
        />
      </svg>
    ),
  },
  microsoft: {
    label: 'Microsoft',
    icon: (
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden focusable="false">
        <path fill="#F25022" d="M1 1h10v10H1z" />
        <path fill="#7FBA00" d="M13 1h10v10H13z" />
        <path fill="#00A4EF" d="M1 13h10v10H1z" />
        <path fill="#FFB900" d="M13 13h10v10H13z" />
      </svg>
    ),
  },
} as const;

/**
 * A federated sign-in button.
 *
 * Disabled, with the reason attached rather than implied: no identity provider
 * is configured, and there is no honest way for this button to sign anyone in
 * until one is.
 */
function ProviderButton({ provider }: { provider: keyof typeof PROVIDERS }) {
  const { label, icon } = PROVIDERS[provider];
  return (
    <button
      type="button"
      disabled
      aria-describedby="sso-unavailable"
      title={`${label} sign-in is not configured for this deployment`}
      className="flex h-[52px] cursor-not-allowed items-center justify-center gap-2.5 rounded-xl border border-line bg-surface text-[15px] font-medium text-ink-800"
    >
      {icon}
      {label}
    </button>
  );
}
