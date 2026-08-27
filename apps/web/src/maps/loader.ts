/**
 * Google Maps JavaScript API loader.
 *
 * Uses the documented dynamic library import bootstrap rather than a script
 * tag with a `libraries=` list, because that is what `importLibrary` needs and
 * it lets each library load only when the screen that needs it mounts.
 * https://developers.google.com/maps/documentation/javascript/load-maps-js-api
 *
 * The API key is read from the environment and never hard-coded. When no key
 * is configured the loader reports `unavailable` and the application falls back
 * to the clearly-labelled demo map — the whole product still runs, which is
 * what makes it possible to develop and test without a billing account.
 */

export type MapsAvailability = 'unavailable' | 'loading' | 'ready' | 'error';

/**
 * What the Maps API is actually doing, as opposed to what was configured.
 *
 * `unauthorized` is the case that matters and the one that is easy to miss:
 * when a key is rejected — wrong key, origin not on the allow-list, billing
 * disabled, API not enabled — Google still serves the script with a 200 and
 * still resolves `importLibrary`. Nothing throws. The map simply renders grey
 * behind an error dialog, and a console that only checks "is a key set?" will
 * report the provider healthy while the operator looks at nothing.
 */
export type MapsHealth = 'no-key' | 'loading' | 'ready' | 'unauthorized' | 'error';

export interface MapsDiagnostics {
  health: MapsHealth;
  /** Libraries that resolved, e.g. `maps`, `routes`. */
  librariesLoaded: string[];
  /** Whether `google.maps.routes` was reachable on this channel. */
  routesLibrary: 'unknown' | 'available' | 'unavailable';
  version: string;
  message?: string;
}

export interface MapsConfig {
  apiKey: string;
  /**
   * Release channel. The Routes library (`google.maps.routes`) is published on
   * the beta channel; on `weekly` the loader falls back to DirectionsService.
   */
  version: string;
  mapId?: string;
}

export function readMapsConfig(): MapsConfig {
  return {
    apiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ?? '',
    version: (import.meta.env.VITE_GOOGLE_MAPS_VERSION as string | undefined)?.trim() || 'beta',
    mapId: (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined)?.trim() || undefined,
  };
}

export function hasApiKey(): boolean {
  return readMapsConfig().apiKey.length > 0;
}

let bootstrapPromise: Promise<void> | undefined;

/**
 * How long to wait for the API script before calling it a failure.
 *
 * Without this the promise never settles when the script is blocked by an
 * extension, a corporate proxy or an offline network — `onerror` does not
 * always fire — and the console sits on a loading spinner indefinitely rather
 * than falling back to the map it can actually draw.
 */
const BOOTSTRAP_TIMEOUT_MS = 15_000;

let health: MapsHealth = 'no-key';
let healthMessage: string | undefined;
let routesLibraryState: 'unknown' | 'available' | 'unavailable' = 'unknown';
const listeners = new Set<(diagnostics: MapsDiagnostics) => void>();

function setHealth(next: MapsHealth, message?: string): void {
  if (health === next && healthMessage === message) return;
  health = next;
  healthMessage = message;
  const snapshot = mapsDiagnostics();
  for (const listener of listeners) listener(snapshot);
}

/** Current provider state, derived rather than assumed from configuration. */
export function mapsDiagnostics(): MapsDiagnostics {
  const config = readMapsConfig();
  return {
    health: config.apiKey ? health : 'no-key',
    librariesLoaded: [...libraryCache.keys()],
    routesLibrary: routesLibraryState,
    version: config.version,
    ...(healthMessage ? { message: healthMessage } : {}),
  };
}

/** Subscribe to provider state. Returns an unsubscribe function. */
export function onMapsHealthChange(listener: (diagnostics: MapsDiagnostics) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Install Google's authentication-failure callback.
 *
 * This is the only signal the Maps API gives for a rejected key. It is a
 * global function it looks for by name, so it has to be on `window` before the
 * script runs.
 */
function installAuthFailureHook(): void {
  const target = window as unknown as Record<string, unknown>;
  if (target.gm_authFailure) return;
  target.gm_authFailure = () => {
    setHealth(
      'unauthorized',
      'Google rejected the API key. Check that the key is valid, that Maps JavaScript API and ' +
        'Routes API are enabled on it, that billing is active, and that this origin is on the ' +
        "key's allow-list.",
    );
  };
}

/**
 * Install the Maps JS API bootstrap.
 *
 * This is the official inline loader, transcribed rather than copied verbatim
 * so it is readable: it defines `google.maps.importLibrary` as a function that
 * injects the API script on first use and resolves once it is ready.
 */
function installBootstrap(config: MapsConfig): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('Google Maps can only be loaded in a browser.'));
      return;
    }

    setHealth('loading');
    installAuthFailureHook();

    // Already bootstrapped by a previous mount.
    const existing = (window as { google?: { maps?: { importLibrary?: unknown } } }).google;
    if (existing?.maps?.importLibrary) {
      setHealth('ready');
      resolve();
      return;
    }

    const timer = window.setTimeout(() => {
      bootstrapPromise = undefined;
      const message =
        'Google Maps did not load within 15 seconds. It may be blocked by a browser extension, ' +
        'a network policy, or an unreachable network.';
      setHealth('error', message);
      reject(new Error(message));
    }, BOOTSTRAP_TIMEOUT_MS);

    const params = new URLSearchParams({
      key: config.apiKey,
      v: config.version,
      loading: 'async',
      callback: '__smartErMapsReady',
    });

    (window as unknown as Record<string, unknown>).__smartErMapsReady = () => {
      delete (window as unknown as Record<string, unknown>).__smartErMapsReady;
      window.clearTimeout(timer);
      // A rejected key can be reported before this callback runs; do not
      // overwrite that with `ready`, because the script loading is not the
      // same thing as the script being allowed to serve tiles.
      if (health !== 'unauthorized') setHealth('ready');
      resolve();
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      bootstrapPromise = undefined;
      window.clearTimeout(timer);
      const message =
        'Google Maps failed to load. Check that the API key is valid, that Maps JavaScript API ' +
        'and Routes API are enabled, and that this origin is allowed on the key.';
      setHealth('error', message);
      reject(new Error(message));
    };
    document.head.appendChild(script);
  });

  return bootstrapPromise;
}

const libraryCache = new Map<string, Promise<unknown>>();

/**
 * Load a Maps library by name, e.g. `maps`, `marker`, `routes`, `places`.
 * Repeated calls for the same library share one promise.
 */
export async function loadMapsLibrary<T>(name: string): Promise<T> {
  const config = readMapsConfig();
  if (!config.apiKey) {
    throw new Error('No Google Maps API key is configured.');
  }
  await installBootstrap(config);

  const cached = libraryCache.get(name);
  if (cached) return cached as Promise<T>;

  const promise = google.maps.importLibrary(name) as Promise<unknown>;
  libraryCache.set(name, promise);

  if (name === 'routes') {
    // Recorded rather than thrown: an unavailable Routes library is a fallback
    // to DirectionsService, not a failure, but the operator should be able to
    // see which one answered.
    void promise.then(
      () => {
        routesLibraryState = 'available';
      },
      () => {
        routesLibraryState = 'unavailable';
        libraryCache.delete(name);
      },
    );
  }

  return promise as Promise<T>;
}

/** Reset loader state. Test-only. */
export function resetMapsLoader(): void {
  bootstrapPromise = undefined;
  libraryCache.clear();
  health = 'no-key';
  healthMessage = undefined;
  routesLibraryState = 'unknown';
  listeners.clear();
  if (typeof window !== 'undefined') {
    delete (window as unknown as Record<string, unknown>).gm_authFailure;
  }
}
