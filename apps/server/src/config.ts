import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
// Load the repository-root .env so one file configures server and web alike.
dotenv.config({ path: path.resolve(here, '../../../.env'), quiet: true });

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function float(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

/**
 * A missing signing secret is a configuration error in production, not
 * something to paper over with a constant. Outside production a random secret
 * is generated per boot: development still works with no setup, and tokens
 * from a previous run stop being accepted, which is the safer default.
 */
function resolveJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured && configured.length >= 16) return configured;
  if (isProduction) {
    throw new Error(
      'JWT_SECRET must be set to at least 16 characters when NODE_ENV=production. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    );
  }
  if (configured) {
    console.warn('[config] JWT_SECRET is shorter than 16 characters; generating a temporary secret instead.');
  }
  return crypto.randomBytes(48).toString('hex');
}

/**
 * Defaults to `data/smart-er.db` beside the repository, so a plain
 * `npm run dev` is durable without anything to configure. Set DATABASE_PATH to
 * an empty string to opt back out.
 */
function resolveDatabasePath(): string {
  if (isTest) return '';
  const configured = process.env.DATABASE_PATH;
  if (configured !== undefined) return configured.trim();
  return path.resolve(here, '../../../data/smart-er.db');
}

export const config = {
  nodeEnv,
  isProduction,
  isTest,
  host: process.env.HOST ?? '0.0.0.0',
  port: int(process.env.PORT, 4000),

  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',

  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  simulation: {
    tickMs: int(process.env.SIM_TICK_MS, 1000),
    speed: float(process.env.SIM_SPEED, 1),
    /** Auto-start the idle traffic simulation so a fresh dashboard is not blank. */
    autoStart: process.env.SIM_AUTOSTART !== 'false',
  },

  /**
   * Which hardware implementation to construct at boot.
   * Phase 1 is always `simulated`; Phase 2 adds `esp32` behind the same
   * interfaces without touching anything above the abstraction layer.
   */
  hardwareTransport: (process.env.HARDWARE_TRANSPORT ?? 'simulated') as 'simulated' | 'mqtt' | 'websocket',

  /** Server-side Google key, used only if server-side route enrichment is added. */
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',

  /**
   * Where operational state is stored.
   *
   * A path means SQLite, and the system picks up where it left off. The empty
   * string means memory only, which is what the tests want and what someone
   * demonstrating from a clean slate every time wants. Tests default to memory
   * regardless, so a stray DATABASE_PATH in the environment cannot make one
   * test run visible to the next.
   */
  databasePath: resolveDatabasePath(),

  /**
   * Where the browser reaches this deployment. Used to build password-reset
   * links, which have to point at the web app rather than at the API.
   */
  appBaseUrl: process.env.APP_BASE_URL?.trim() || 'http://localhost:5173',
} as const;

export type Config = typeof config;
