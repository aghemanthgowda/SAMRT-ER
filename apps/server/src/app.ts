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

  // Login is the one endpoint worth rate-limiting hard: everything else is
  // already behind a token.
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

  app.use('/api', buildRouter(context));
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
