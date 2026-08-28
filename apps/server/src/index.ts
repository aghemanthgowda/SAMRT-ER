import { createServer } from 'node:http';
import os from 'node:os';
import { config } from './config.js';
import { createApp } from './app.js';
import { Store } from './db/store.js';
import { attachRealtime } from './realtime/socket.js';
import { createContext } from './services/context.js';
import { scenarioSummaries } from './simulation/scenarios.js';

async function main(): Promise<void> {
  const store = Store.create({ databasePath: config.databasePath || undefined });
  const context = createContext(store);
  const app = createApp(context);
  const httpServer = createServer(app);

  attachRealtime(httpServer, context);

  if (config.simulation.autoStart) {
    context.simulation.start();
  }

  /*
   * A named scenario makes a cold start arrive with units already moving. An
   * unrecognised name is worth reporting rather than crashing on: the server
   * is still useful without it, and the message says which names work.
   */
  if (config.simulation.scenario) {
    try {
      const state = await context.simulation.startScenario(config.simulation.scenario);
      console.log(`[smart-er] scenario running: ${state.scenarioName ?? config.simulation.scenario}`);
    } catch {
      console.warn(
        `[smart-er] SIM_SCENARIO="${config.simulation.scenario}" is not a scenario. Try one of:\n` +
          scenarioSummaries()
            .map((s) => `      ${s.id}`)
            .join('\n'),
      );
    }
  }

  /*
   * A port already in use is the most common way this fails to start, and the
   * usual cause is an earlier run that was never stopped. Node's default for
   * that is an unhandled 'error' event and a stack trace, which says what
   * happened but not what to do about it.
   */
  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EADDRINUSE') throw error;
    console.error(
      `\n[smart-er] Port ${config.port} is already in use.\n\n` +
        '  Something is still listening there — almost always a server from an\n' +
        '  earlier run. Stop it, then start again:\n\n' +
        '      Windows      Get-Process node | Stop-Process -Force\n' +
        '      macOS/Linux  pkill -f "node dist" ; pkill -f "tsx watch"\n\n' +
        `  Or run on a different port:  PORT=${config.port + 100} npm start\n`,
    );
    process.exit(1);
  });

  httpServer.listen(config.port, config.host, () => {
    for (const address of lanAddresses()) {
      console.info(`[smart-er] reachable on this network at http://${address}:${config.port}`);
    }
    console.info(
      `[smart-er] API listening on http://${config.host}:${config.port} ` +
        `(${config.nodeEnv}, hardware: ${store.hardware.mode.toLowerCase()}, ` +
        `${store.graph.junctions.length} junctions, ` +
        `storage: ${config.databasePath ? `${config.databasePath}${store.seeded ? ' — seeded' : ''}` : 'in memory'})`,
    );
  });

  const shutdown = async (signal: string) => {
    console.info(`[smart-er] ${signal} received, shutting down.`);
    await context.shutdown();
    store.close();
    httpServer.close(() => process.exit(0));
    // Do not let a hung connection prevent the process from exiting.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

/**
 * The addresses another device on the same network can open.
 *
 * Printed at boot because the alternative is hunting for the machine's IP with
 * `ipconfig` — and `localhost` is the one address that is guaranteed not to
 * work from a phone.
 */
function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry): entry is os.NetworkInterfaceInfo => Boolean(entry))
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

main().catch((error) => {
  console.error('[smart-er] failed to start:', error);
  process.exit(1);
});
