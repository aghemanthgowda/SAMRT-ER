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

  login(email: string, password: string, remember?: boolean): Promise<void>;
  logout(): void;
  restore(): Promise<void>;
  clearError(): void;
}

/**
 * Where the token is kept is what "Remember me" actually decides.
 *
 * Checked, it goes to localStorage and survives closing the browser. Left
 * unchecked it goes to sessionStorage: a reload mid-incident still works —
 * which is the case that matters in a control room — but the session ends with
 * the tab. That is the honest meaning of the checkbox, and the safer default
 * for a shared machine.
 *
 * Either way the token is short-lived server-side and `restore` re-validates
 * it rather than trusting what it finds.
 */
function readStoredToken(): string | undefined {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) ?? window.localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStoredToken(token: string | undefined, remember = false): void {
  try {
    // Clear both first, so switching the checkbox cannot leave a token behind
    // in the store the user just opted out of.
    window.localStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(TOKEN_KEY);
    if (!token) return;
    (remember ? window.localStorage : window.sessionStorage).setItem(TOKEN_KEY, token);
  } catch {
    // Private browsing or blocked storage: the session simply will not persist.
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  vehicles: [],
  status: 'idle',

  async login(email, password, remember = false) {
    set({ status: 'authenticating', error: undefined });
    try {
      const result = await api.login(email, password);
      setAuthToken(result.token);
      writeStoredToken(result.token, remember);
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
