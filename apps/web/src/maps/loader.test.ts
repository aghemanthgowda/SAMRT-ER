import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasApiKey,
  loadMapsLibrary,
  mapsDiagnostics,
  onMapsHealthChange,
  readMapsConfig,
  resetMapsLoader,
} from './loader';

describe('Google Maps loader', () => {
  afterEach(() => {
    resetMapsLoader();
    vi.unstubAllEnvs();
  });

  it('reports no key when the environment variable is unset', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    expect(hasApiKey()).toBe(false);
    expect(readMapsConfig().apiKey).toBe('');
  });

  it('treats a whitespace-only key as absent', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '   ');
    expect(hasApiKey()).toBe(false);
  });

  it('reports a key when one is configured', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key-value');
    expect(hasApiKey()).toBe(true);
    expect(readMapsConfig().apiKey).toBe('test-key-value');
  });

  it('defaults to the beta channel, where the Routes library is published', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_VERSION', '');
    expect(readMapsConfig().version).toBe('beta');
  });

  it('honours an explicit version channel', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_VERSION', 'weekly');
    expect(readMapsConfig().version).toBe('weekly');
  });

  it('refuses to load a library without a key rather than injecting a broken script', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    await expect(loadMapsLibrary('maps')).rejects.toThrow(/No Google Maps API key is configured/);
    // Nothing should have been added to the document.
    expect(document.querySelectorAll('script[src*="maps.googleapis.com"]')).toHaveLength(0);
  });

  it('reads the key from the environment rather than a build-time constant', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'first-value');
    expect(readMapsConfig().apiKey).toBe('first-value');
    // Changing the environment changes what the loader reports, which is only
    // true if nothing captured the key at module load.
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'second-value');
    expect(readMapsConfig().apiKey).toBe('second-value');
  });
});

/**
 * How a rejected key actually arrives.
 *
 * Google serves the API script with a 200 even when the key is invalid, the
 * origin is not allowed, billing is off, or the API is not enabled. Nothing
 * throws and `importLibrary` still resolves; the only signal is a call to the
 * global `gm_authFailure`. A console that infers health from "is a key set?"
 * therefore reports the provider connected over a grey, empty map — which is
 * what these tests exist to prevent regressing.
 */
describe('provider health', () => {
  afterEach(() => {
    resetMapsLoader();
    vi.unstubAllEnvs();
    document.querySelectorAll('script[src*="maps.googleapis.com"]').forEach((node) => node.remove());
  });

  function bootstrap(): void {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key-value');
    // Kick off a load so the bootstrap installs its hooks. The promise stays
    // pending, which is exactly the real state while the script is in flight.
    void loadMapsLibrary('maps').catch(() => undefined);
  }

  it('reports no key before anything is configured', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    expect(mapsDiagnostics().health).toBe('no-key');
  });

  it('installs the global Google calls when it rejects a key', () => {
    bootstrap();
    expect(typeof (window as unknown as Record<string, unknown>).gm_authFailure).toBe('function');
  });

  it('turns a rejected key into an unauthorized provider, not a healthy one', () => {
    bootstrap();
    expect(mapsDiagnostics().health).toBe('loading');

    (window as unknown as { gm_authFailure: () => void }).gm_authFailure();

    expect(mapsDiagnostics().health).toBe('unauthorized');
    expect(mapsDiagnostics().message).toMatch(/rejected the API key/i);
  });

  it('notifies subscribers so a screen already showing a map can correct itself', () => {
    bootstrap();
    const seen: string[] = [];
    const unsubscribe = onMapsHealthChange((diagnostics) => seen.push(diagnostics.health));

    (window as unknown as { gm_authFailure: () => void }).gm_authFailure();
    unsubscribe();

    expect(seen).toContain('unauthorized');
  });

  it('stops notifying after unsubscribe', () => {
    bootstrap();
    const seen: string[] = [];
    onMapsHealthChange((diagnostics) => seen.push(diagnostics.health))();

    (window as unknown as { gm_authFailure: () => void }).gm_authFailure();

    expect(seen).toHaveLength(0);
  });

  it('reports the script failing to load as an unreachable provider', async () => {
    bootstrap();
    const script = document.querySelector('script[src*="maps.googleapis.com"]') as HTMLScriptElement;
    expect(script).toBeTruthy();

    script.onerror?.(new Event('error'));

    expect(mapsDiagnostics().health).toBe('error');
    expect(mapsDiagnostics().message).toMatch(/failed to load/i);
  });

  it('gives up rather than spinning forever when the script never answers', () => {
    vi.useFakeTimers();
    try {
      bootstrap();
      expect(mapsDiagnostics().health).toBe('loading');

      vi.advanceTimersByTime(15_001);

      expect(mapsDiagnostics().health).toBe('error');
      expect(mapsDiagnostics().message).toMatch(/did not load within/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not overwrite a rejection with ready when the load callback arrives after it', () => {
    bootstrap();
    (window as unknown as { gm_authFailure: () => void }).gm_authFailure();

    // Google calls the ready callback even for a rejected key.
    (window as unknown as Record<string, () => void>).__smartErMapsReady?.();

    expect(mapsDiagnostics().health).toBe('unauthorized');
  });

  it('reports no key even after a rejection once the key is removed', () => {
    bootstrap();
    (window as unknown as { gm_authFailure: () => void }).gm_authFailure();
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');

    expect(mapsDiagnostics().health).toBe('no-key');
  });
});
