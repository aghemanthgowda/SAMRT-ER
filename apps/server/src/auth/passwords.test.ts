import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { Store } from '../db/store.js';
import { createContext, type AppContext } from '../services/context.js';
import {
  ConsolePasswordResetDelivery,
  RESET_TOKEN_TTL_MINUTES,
  hashResetToken,
  requestPasswordReset,
  validatePassword,
} from './passwords.js';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe!2024';
const CONTROLLER = 'controller@smart-er.example';

let store: Store;
let context: AppContext;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  store = Store.create({ hardwareSeed: 91 });
  context = createContext(store);
  app = createApp(context);
});

async function tokenFor(email: string, password = SEED_PASSWORD): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return response.body.token as string;
}

/** Capture what the delivery adapter was handed, standing in for a mailbox. */
function capturingDelivery() {
  const sent: { email: string; resetUrl: string; expiresAt: string }[] = [];
  return {
    sent,
    delivery: {
      channel: 'test',
      send(message: { email: string; displayName: string; resetUrl: string; expiresAt: string }) {
        sent.push(message);
      },
    },
  };
}

function tokenFromUrl(url: string): string {
  return new URL(url).searchParams.get('token')!;
}

describe('password policy', () => {
  const user = { email: 'controller@smart-er.example', displayName: 'Control Room' };

  it('rejects a password short enough to brute force', () => {
    expect(validatePassword('short', user)).toMatch(/at least 12/);
  });

  it('rejects a password derived from the account it protects', () => {
    expect(validatePassword('controller-please', user)).toMatch(/email address/i);
    expect(validatePassword('smart-er-corridor', user)).toMatch(/name of the system/i);
  });

  it('accepts a long unrelated password', () => {
    expect(validatePassword('quiet harbour lantern', user)).toBeUndefined();
  });
});

describe('changing a password', () => {
  it('changes it, and the new one is the one that works', async () => {
    const token = await tokenFor(CONTROLLER);

    const change = await request(app)
      .post('/api/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: SEED_PASSWORD, newPassword: 'quiet harbour lantern' });
    expect(change.status).toBe(200);

    const withOld = await request(app).post('/api/auth/login').send({ email: CONTROLLER, password: SEED_PASSWORD });
    expect(withOld.status).toBe(401);

    const withNew = await request(app)
      .post('/api/auth/login')
      .send({ email: CONTROLLER, password: 'quiet harbour lantern' });
    expect(withNew.status).toBe(200);
  });

  it('refuses without the current password, even with a valid token', async () => {
    const token = await tokenFor(CONTROLLER);

    const response = await request(app)
      .post('/api/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'not the password', newPassword: 'quiet harbour lantern' });

    expect(response.status).toBe(401);
    // The old password still works, so nothing was changed on the way to the refusal.
    expect((await request(app).post('/api/auth/login').send({ email: CONTROLLER, password: SEED_PASSWORD })).status).toBe(
      200,
    );
  });

  it('refuses a new password that fails the policy', async () => {
    const token = await tokenFor(CONTROLLER);

    const response = await request(app)
      .post('/api/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: SEED_PASSWORD, newPassword: 'abc' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/at least 12/);
  });

  it('refuses to set the password it already has', async () => {
    const token = await tokenFor(CONTROLLER);

    const response = await request(app)
      .post('/api/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: SEED_PASSWORD, newPassword: SEED_PASSWORD });

    expect(response.status).toBe(400);
  });

  it('cannot be called without a session', async () => {
    const response = await request(app)
      .post('/api/auth/password/change')
      .send({ currentPassword: SEED_PASSWORD, newPassword: 'quiet harbour lantern' });

    expect(response.status).toBe(401);
  });
});

describe('recovering a password', () => {
  it('accepts the request identically for a known and an unknown address', async () => {
    const known = await request(app).post('/api/auth/password/forgot').send({ email: CONTROLLER });
    const unknown = await request(app).post('/api/auth/password/forgot').send({ email: 'nobody@nowhere.example' });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
  });

  it('never returns the token through the API that created it', async () => {
    const response = await request(app).post('/api/auth/password/forgot').send({ email: CONTROLLER });
    const body = JSON.stringify(response.body);

    expect(body).not.toMatch(/token/i);
    // One token exists — it just is not reachable through the response.
    expect(store.outstandingPasswordResets).toBe(1);
  });

  it('stores the token only as a hash', async () => {
    const { delivery, sent } = capturingDelivery();
    await requestPasswordReset(store, CONTROLLER, delivery);

    const token = tokenFromUrl(sent[0]!.resetUrl);
    expect(store.findPasswordReset(hashResetToken(token))).toBeDefined();
    // The token itself is not a key into storage.
    expect(store.findPasswordReset(token)).toBeUndefined();
  });

  it('resets the password and lets the new one sign in', async () => {
    const { delivery, sent } = capturingDelivery();
    await requestPasswordReset(store, CONTROLLER, delivery);
    const token = tokenFromUrl(sent[0]!.resetUrl);

    const reset = await request(app)
      .post('/api/auth/password/reset')
      .send({ token, newPassword: 'harbour lantern quiet' });
    expect(reset.status).toBe(200);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: CONTROLLER, password: 'harbour lantern quiet' });
    expect(login.status).toBe(200);
  });

  it('will not accept the same token twice', async () => {
    const { delivery, sent } = capturingDelivery();
    await requestPasswordReset(store, CONTROLLER, delivery);
    const token = tokenFromUrl(sent[0]!.resetUrl);

    expect((await request(app).post('/api/auth/password/reset').send({ token, newPassword: 'first choice pass' })).status).toBe(
      200,
    );

    const replay = await request(app)
      .post('/api/auth/password/reset')
      .send({ token, newPassword: 'second choice pass' });
    expect(replay.status).toBe(400);

    // The replay changed nothing.
    expect((await request(app).post('/api/auth/login').send({ email: CONTROLLER, password: 'first choice pass' })).status).toBe(
      200,
    );
  });

  it('retires an earlier link when a second is requested', async () => {
    const { delivery, sent } = capturingDelivery();
    await requestPasswordReset(store, CONTROLLER, delivery);
    await requestPasswordReset(store, CONTROLLER, delivery);

    const first = tokenFromUrl(sent[0]!.resetUrl);
    const second = tokenFromUrl(sent[1]!.resetUrl);

    expect((await request(app).post('/api/auth/password/reset').send({ token: first, newPassword: 'stale link pass' })).status).toBe(
      400,
    );
    expect((await request(app).post('/api/auth/password/reset').send({ token: second, newPassword: 'fresh link pass' })).status).toBe(
      200,
    );
  });

  it('expires a link that is left unused', async () => {
    const { delivery, sent } = capturingDelivery();
    await requestPasswordReset(store, CONTROLLER, delivery);
    const token = tokenFromUrl(sent[0]!.resetUrl);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + (RESET_TOKEN_TTL_MINUTES + 1) * 60_000));
    try {
      const response = await request(app)
        .post('/api/auth/password/reset')
        .send({ token, newPassword: 'too late for this' });
      expect(response.status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the same answer for an unknown token as for an expired one', async () => {
    const response = await request(app)
      .post('/api/auth/password/reset')
      .send({ token: 'not-a-real-token', newPassword: 'perfectly fine pass' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/no longer valid/i);
  });

  it('refuses a replacement that fails the policy', async () => {
    const { delivery, sent } = capturingDelivery();
    await requestPasswordReset(store, CONTROLLER, delivery);
    const token = tokenFromUrl(sent[0]!.resetUrl);

    const response = await request(app).post('/api/auth/password/reset').send({ token, newPassword: 'short' });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/at least 12/);
  });

  it('issues nothing for a deactivated account', async () => {
    const user = store.repositories.users.find((entry) => entry.email === CONTROLLER)[0]!;
    store.repositories.users.put({ ...user, active: false });

    const { delivery, sent } = capturingDelivery();
    await requestPasswordReset(store, CONTROLLER, delivery);

    expect(sent).toHaveLength(0);
    expect(store.outstandingPasswordResets).toBe(0);
  });

  it('publishes the minimum length so the browser can check before submitting', async () => {
    const response = await request(app).get('/api/auth/password/policy');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ minLength: 12 });
  });
});

describe('the console delivery adapter', () => {
  const message = {
    email: CONTROLLER,
    displayName: 'Control Room',
    resetUrl: 'https://example.test/reset-password?token=SECRET',
    expiresAt: new Date().toISOString(),
  };

  function captureLogs(run: () => void): string {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      run();
      return [...warn.mock.calls, ...info.mock.calls].flat().join(' ');
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  }

  it('withholds the link where logs are shipped elsewhere', () => {
    const logged = captureLogs(() => new ConsolePasswordResetDelivery(true).send(message));

    expect(logged).not.toContain('SECRET');
    // It still says a reset was requested, so the request is not invisible.
    expect(logged).toMatch(/password reset requested/i);
  });

  it('prints the link for an operator at the machine', () => {
    const logged = captureLogs(() => new ConsolePasswordResetDelivery(false).send(message));

    expect(logged).toContain('SECRET');
  });
});
