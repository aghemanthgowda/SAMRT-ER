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

    // Already bootstrapped by a previous mount.
    const existing = (window as { google?: { maps?: { importLibrary?: unknown } } }).google;
    if (existing?.maps?.importLibrary) {
      resolve();
      return;
    }

    const params = new URLSearchParams({
      key: config.apiKey,
      v: config.version,
      loading: 'async',
      callback: '__smartErMapsReady',
    });

    (window as unknown as Record<string, unknown>).__smartErMapsReady = () => {
      delete (window as unknown as Record<string, unknown>).__smartErMapsReady;
      resolve();
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      bootstrapPromise = undefined;
      reject(
        new Error(
          'Google Maps failed to load. Check that the API key is valid, that Maps JavaScript API ' +
            'and Routes API are enabled, and that this origin is allowed on the key.',
        ),
      );
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
  return promise as Promise<T>;
}

/** Reset loader state. Test-only. */
export function resetMapsLoader(): void {
  bootstrapPromise = undefined;
  libraryCache.clear();
}
