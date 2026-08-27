import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { User } from '@smart-er/core';
import { config } from '../config.js';
import type { Store } from '../db/store.js';
import { AuthError } from './auth.js';

/**
 * Password change and recovery.
 *
 * Recovery is the part of an authentication system most often bolted on, and
 * it is the part most often used to get in: whatever guarantees sign-in makes
 * are worth exactly as much as the weakest way of replacing a password. So the
 * rules here are deliberately narrow — a reset token is random, stored only as
 * a hash, single-use, short-lived, and never returned through the API that
 * created it. It has to be delivered out of band to be worth anything.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const RESET_TOKEN_TTL_MINUTES = 30;
const BCRYPT_ROUNDS = 10;

export interface PasswordResetRecord {
  /** SHA-256 of the token. The token itself is never stored. */
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

/**
 * Where a reset link is sent.
 *
 * The same shape as the hardware abstraction layer, and for the same reason:
 * Phase 1 has no mail relay, but the flow around it should not have to change
 * when one arrives. An adapter that puts the link in an email, an SMS or a
 * control-room queue implements this and nothing else moves.
 */
export interface PasswordResetDelivery {
  readonly channel: string;
  send(message: { email: string; displayName: string; resetUrl: string; expiresAt: string }): Promise<void> | void;
}

/**
 * The Phase 1 adapter: the link goes to the server log.
 *
 * That is appropriate for an operator sitting at the machine and unacceptable
 * anywhere else, so in production it logs that a reset was requested and
 * withholds the link — a token in a log file that is shipped to a log
 * aggregator is a token in the hands of everyone with log access.
 */
export class ConsolePasswordResetDelivery implements PasswordResetDelivery {
  readonly channel = 'console';

  /**
   * `withholdLink` is a constructor argument rather than a read of the global
   * config at send time so the withholding branch can actually be tested —
   * a safety property nobody can exercise is a safety property nobody knows
   * still works.
   */
  constructor(private readonly withholdLink: boolean = config.isProduction) {}

  send(message: { email: string; displayName: string; resetUrl: string; expiresAt: string }): void {
    if (this.withholdLink) {
      console.warn(
        `[auth] password reset requested for ${message.email}, but no delivery channel is configured. ` +
          'Configure a PasswordResetDelivery adapter; the link has not been logged.',
      );
      return;
    }
    console.info(
      `[auth] password reset for ${message.email} (${message.displayName})\n` +
        `       ${message.resetUrl}\n` +
        `       expires ${message.expiresAt}`,
    );
  }
}

/**
 * Reject a password that would not survive a guess.
 *
 * Length carries most of the weight; a composition rule ("one symbol, one
 * digit") mostly teaches people to write Password1! and does not. The two
 * extra checks are for passwords that are trivially derivable from the account
 * they protect.
 */
export function validatePassword(password: string, user: Pick<User, 'email' | 'displayName'>): string | undefined {
  const trimmed = password.trim();

  if (trimmed.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (trimmed.length > 200) {
    return 'Password must be 200 characters or fewer.';
  }

  const lowered = trimmed.toLowerCase();
  const localPart = user.email.split('@')[0]?.toLowerCase() ?? '';

  if (localPart.length >= 3 && lowered.includes(localPart)) {
    return 'Password must not contain your email address.';
  }
  if (lowered.includes('smart-er') || lowered.includes('smarter')) {
    return 'Password must not contain the name of the system.';
  }
  return undefined;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

/**
 * Change the password of a signed-in account.
 *
 * The current password is required even though the caller is already
 * authenticated: a token left behind on an unlocked machine should not be
 * enough to lock its owner out of their own account.
 */
export async function changePassword(
  store: Store,
  user: User,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const existing = store.passwordHashes.get(user.id);
  const ok = existing ? await bcrypt.compare(currentPassword, existing) : false;
  if (!ok) throw new AuthError('Current password is not correct.');

  const problem = validatePassword(newPassword, user);
  if (problem) throw new AuthError(problem, 400);

  if (await bcrypt.compare(newPassword, existing!)) {
    throw new AuthError('New password must be different from the current one.', 400);
  }

  store.setPasswordHash(user.id, hashPassword(newPassword));
  store.revokePasswordResets(user.id);
}

export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Begin recovery for an address.
 *
 * Returns nothing in every case, including when the address is unknown. The
 * caller cannot distinguish the two, which is the point: an endpoint that
 * answers "no such account" is an account-enumeration oracle reachable without
 * credentials, and this system's account list is a list of who staffs which
 * control room.
 */
export async function requestPasswordReset(
  store: Store,
  email: string,
  delivery: PasswordResetDelivery,
): Promise<void> {
  const normalised = email.trim().toLowerCase();
  const user = store.repositories.users.find((entry) => entry.email.toLowerCase() === normalised)[0];

  if (!user || !user.active) return;

  // One live token per account: issuing a second should retire the first,
  // otherwise every request widens the window instead of moving it.
  store.revokePasswordResets(user.id);

  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60_000);

  store.putPasswordReset({
    tokenHash: hashResetToken(token),
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  const resetUrl = `${config.appBaseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  await delivery.send({
    email: user.email,
    displayName: user.displayName,
    resetUrl,
    expiresAt: expiresAt.toISOString(),
  });
}

/**
 * Complete recovery.
 *
 * Every failure — unknown token, expired token, already-used token — is the
 * same message, so the endpoint cannot be used to learn which tokens exist.
 */
export async function completePasswordReset(store: Store, token: string, newPassword: string): Promise<User> {
  const record = store.findPasswordReset(hashResetToken(token));
  const invalid = new AuthError('This reset link is no longer valid. Request a new one.', 400);

  if (!record || record.usedAt) throw invalid;
  if (Date.parse(record.expiresAt) <= Date.now()) throw invalid;

  const user = store.repositories.users.get(record.userId);
  if (!user || !user.active) throw invalid;

  const problem = validatePassword(newPassword, user);
  if (problem) throw new AuthError(problem, 400);

  store.setPasswordHash(user.id, hashPassword(newPassword));
  // Consume the token and clear any other outstanding ones for the account,
  // so a link from an earlier request cannot be replayed afterwards.
  store.revokePasswordResets(user.id);
  return user;
}
