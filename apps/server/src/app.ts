import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { buildRouter } from './routes/index.js';
import type { AppContext } from './services/context.js';

export function createApp(context: AppContext): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // The API serves JSON to a separate origin and embeds nothing, so the
  // cross-origin isolation defaults would only get in the browser's way.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // The unauthenticated auth endpoints are the ones worth rate-limiting hard:
  // everything else is already behind a token.
  app.use(
    '/api/auth/login',
    rateLimit({
      windowMs: 60_000,
      limit: config.isTest ? 1000 : 20,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many sign-in attempts. Try again shortly.' },
    }),
  );

  /*
   * Recovery is rate-limited harder than sign-in and on a longer window.
   *
   * `forgot` sends mail to an address the caller chose, so an open one is both
   * an enumeration probe and a way to use this server to spam someone.
   * `reset` accepts a 256-bit token, which is not guessable, but a limit costs
   * nothing and bounds the attempt rate anyway.
   */
  app.use(
    ['/api/auth/password/forgot', '/api/auth/password/reset'],
    rateLimit({
      windowMs: 15 * 60_000,
      limit: config.isTest ? 1000 : 5,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many password recovery attempts. Try again later.' },
    }),
  );

  app.use('/api', buildRouter(context));
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
