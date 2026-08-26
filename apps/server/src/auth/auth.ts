import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Role, User } from '@smart-er/core';
import { config } from '../config.js';
import type { Store } from '../db/store.js';

export interface TokenPayload {
  sub: string;
  role: Role;
  driverId?: string;
  facilityId?: string;
}

export interface AuthResult {
  token: string;
  user: User;
  expiresIn: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export function signToken(user: User): string {
  const payload: TokenPayload = {
    sub: user.id,
    role: user.role,
    ...(user.driverId ? { driverId: user.driverId } : {}),
    ...(user.facilityId ? { facilityId: user.facilityId } : {}),
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

export function verifyToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, config.jwtSecret) as TokenPayload;
  } catch {
    throw new AuthError('Session token is invalid or has expired.');
  }
}

/**
 * Authenticate an operator.
 *
 * The same generic message is returned for an unknown address and a wrong
 * password: distinguishing them would let anyone enumerate which emergency
 * accounts exist.
 */
export async function login(store: Store, email: string, password: string): Promise<AuthResult> {
  const normalised = email.trim().toLowerCase();
  const user = store.repositories.users.find((entry) => entry.email.toLowerCase() === normalised)[0];
  const hash = user ? store.passwordHashes.get(user.id) : undefined;

  // Always run a comparison so a missing account and a wrong password take a
  // similar amount of time.
  const placeholder = '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(password, hash ?? placeholder);

  if (!user || !hash || !ok) {
    throw new AuthError('Email address or password is not recognised.');
  }
  if (!user.active) {
    throw new AuthError('This account has been deactivated. Contact your administrator.', 403);
  }

  return { token: signToken(user), user, expiresIn: config.jwtExpiresIn };
}

export function userFromToken(store: Store, token: string): User {
  const payload = verifyToken(token);
  const user = store.repositories.users.get(payload.sub);
  if (!user) throw new AuthError('The account on this session no longer exists.');
  if (!user.active) throw new AuthError('This account has been deactivated.', 403);
  return user;
}
