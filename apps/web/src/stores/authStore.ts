import { create } from 'zustand';
import type { Driver, Facility, User } from '@smart-er/core';
import { ApiError, api, setAuthToken } from '@/api/client';
import { disconnectSocket } from '@/api/socket';

const TOKEN_KEY = 'smart-er.token';

interface AuthState {
  token?: string;
  user?: User;
  driver?: Driver;
  facility?: Facility;
  vehicles: { id: string; callSign: string }[];
  status: 'idle' | 'restoring' | 'authenticating' | 'authenticated' | 'error';
  error?: string;

  login(email: string, password: string): Promise<void>;
  logout(): void;
  restore(): Promise<void>;
  clearError(): void;
}

/**
 * The token is kept in localStorage so a controller who reloads mid-incident
 * is not thrown back to a sign-in screen. It is short-lived server-side, and
 * `restore` re-validates it rather than trusting what it finds.
 */
function readStoredToken(): string | undefined {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStoredToken(token: string | undefined): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing or blocked storage: the session simply will not persist.
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  vehicles: [],
  status: 'idle',

  async login(email, password) {
    set({ status: 'authenticating', error: undefined });
    try {
      const result = await api.login(email, password);
      setAuthToken(result.token);
      writeStoredToken(result.token);
      set({
        token: result.token,
        user: result.user,
        driver: result.driver,
        facility: result.facility,
        vehicles: result.vehicles.map((vehicle) => ({ id: vehicle.id, callSign: vehicle.callSign })),
        status: 'authenticated',
        error: undefined,
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Sign-in failed.';
      set({ status: 'error', error: message });
      throw error;
    }
  },

  logout() {
    setAuthToken(undefined);
    writeStoredToken(undefined);
    disconnectSocket();
    set({ token: undefined, user: undefined, driver: undefined, facility: undefined, vehicles: [], status: 'idle' });
  },

  async restore() {
    const token = readStoredToken();
    if (!token) {
      set({ status: 'idle' });
      return;
    }
    set({ status: 'restoring' });
    setAuthToken(token);
    try {
      const me = await api.me();
      set({
        token,
        user: me.user,
        driver: me.driver,
        facility: me.facility,
        vehicles: me.vehicles.map((vehicle) => ({ id: vehicle.id, callSign: vehicle.callSign })),
        status: 'authenticated',
      });
    } catch {
      // An expired or revoked token must not leave the app half-signed-in.
      setAuthToken(undefined);
      writeStoredToken(undefined);
      set({ token: undefined, user: undefined, status: 'idle' });
    }
  },

  clearError() {
    set({ error: undefined });
  },
}));
