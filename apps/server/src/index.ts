import { createServer } from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { Store } from './db/store.js';
import { attachRealtime } from './realtime/socket.js';
import { createContext } from './services/context.js';

async function main(): Promise<void> {
  const store = Store.create();
  const context = createContext(store);
  const app = createApp(context);
  const httpServer = createServer(app);

  attachRealtime(httpServer, context);

  if (config.simulation.autoStart) {
    context.simulation.start();
  }

  httpServer.listen(config.port, config.host, () => {
    console.info(
      `[smart-er] API listening on http://${config.host}:${config.port} ` +
        `(${config.nodeEnv}, hardware: ${store.hardware.mode.toLowerCase()}, ` +
        `${store.graph.junctions.length} junctions)`,
    );
  });

  const shutdown = async (signal: string) => {
    console.info(`[smart-er] ${signal} received, shutting down.`);
    await context.shutdown();
    httpServer.close(() => process.exit(0));
    // Do not let a hung connection prevent the process from exiting.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[smart-er] failed to start:', error);
  process.exit(1);
});
