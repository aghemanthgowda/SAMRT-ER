import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config, isAllowedOrigin } from './config.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { buildRouter } from './routes/index.js';
import type { AppContext } from './services/context.js';

export function createApp(context: AppContext): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  /*
   * A policy the built application can actually run under.
   *
   * Helmet's default `default-src 'self'` is right for a server that only ever
   * answers JSON, and wrong the moment it also serves the page: it would block
   * the Maps JavaScript API outright. These directives allow Google's map and
   * font hosts and nothing else, and stay harmless on the API responses.
   */
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // Nothing here needs cross-origin isolation, and browsers reject the
      // header outright on a plain-http LAN address — which surfaces as a
      // console error on every device that is not localhost.
      crossOriginOpenerPolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://maps.googleapis.com', 'https://maps.gstatic.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com'],
          // The realtime channel is same-origin, but a tunnel terminates TLS
          // in front of it, so both schemes have to be allowed.
          connectSrc: ["'self'", 'ws:', 'wss:', 'https://maps.googleapis.com'],
          workerSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.use(
    cors((req, callback) => {
      const allowed = isAllowedOrigin(req.headers.origin, req.headers.host);
      callback(null, { origin: allowed, credentials: true });
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

  serveWebApp(app);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}


/**
 * Serve the built web application from this server, when there is one.
 *
 * In development the two run separately and Vite proxies the API. Built, they
 * are better as a single origin on a single port: one address to open on a
 * phone or a tablet, no CORS, and no second port to expose. If `apps/web/dist`
 * has not been built this does nothing at all, so the API is unaffected.
 */
function serveWebApp(app: express.Express): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, '../../web/dist');
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) return;

  // Hashed assets can be cached hard; index.html never can, or a deploy would
  // keep serving the previous build to anyone who had already loaded it.
  app.use(express.static(dist, { index: false, maxAge: '1y', immutable: true }));

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    // A request with an extension is asking for a file that was not found;
    // answering it with the app shell would turn a 404 into a confusing 200.
    if (path.extname(req.path)) return next();
    res.sendFile(index);
  });
}
