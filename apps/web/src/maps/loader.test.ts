import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasApiKey, loadMapsLibrary, readMapsConfig, resetMapsLoader } from './loader';

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
