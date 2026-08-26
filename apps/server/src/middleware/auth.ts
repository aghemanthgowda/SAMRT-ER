import type { NextFunction, Request, Response } from 'express';
import type { Role, User } from '@smart-er/core';
import { AuthError, userFromToken } from '../auth/auth.js';
import type { Store } from '../db/store.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

export function authenticate(store: Store) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    try {
      req.user = userFromToken(store, header.slice(7).trim());
      next();
    } catch (error) {
      const status = error instanceof AuthError ? error.status : 401;
      res.status(status).json({ error: (error as Error).message });
    }
  };
}

/** Restrict a route to specific roles. ADMIN is implicitly allowed everywhere. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (user.role !== 'ADMIN' && !roles.includes(user.role)) {
      res.status(403).json({ error: `This action requires one of: ${roles.join(', ')}.` });
      return;
    }
    next();
  };
}

/**
 * A driver may only act on a vehicle they are authorised to operate.
 * Without this, any authenticated driver could submit requests as any unit.
 */
export function requireVehicleAccess(store: Store, vehicleIdOf: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (user.role === 'ADMIN' || user.role === 'CONTROLLER') {
      next();
      return;
    }
    const vehicleId = vehicleIdOf(req);
    const driver = user.driverId ? store.driver(user.driverId) : undefined;
    if (!vehicleId || !driver || !driver.authorizedVehicleIds.includes(vehicleId)) {
      res.status(403).json({ error: 'You are not authorised to operate this vehicle.' });
      return;
    }
    next();
  };
}
