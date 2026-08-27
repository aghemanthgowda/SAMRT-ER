import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // The repository root holds one .env for both the server and the web app.
  const env = loadEnv(mode, path.resolve(here, '../..'), '');

  // Where the API is. Same .env the server reads its own PORT from, so the two
  // cannot drift apart.
  const apiOrigin = env.VITE_API_BASE_URL || `http://localhost:${Number(env.PORT) || 4000}`;

  return {
    plugins: [react(), tailwindcss()],
    envDir: path.resolve(here, '../..'),
    resolve: {
      alias: { '@': path.resolve(here, 'src') },
    },
    server: {
      // Both ports come from the root .env, so one file moves the whole stack
      // off a pair that something else is already holding.
      port: Number(env.WEB_PORT) || 5173,
      /*
       * Fail rather than drift.
       *
       * By default Vite silently takes the next free port when its own is
       * busy — which leaves a new front end talking to whatever old server
       * still holds the API port, and the change you just made appears not to
       * have worked. Better to stop and say the port is taken.
       */
      strictPort: true,
      host: true,
      proxy: {
        '/api': { target: apiOrigin, changeOrigin: true },
        '/socket.io': { target: apiOrigin, ws: true, changeOrigin: true },
      },
    },
    preview: { port: 4173, host: true },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          // Split the framework and realtime transport out of the app bundle so
          // a dashboard reload does not re-download code that never changes.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
              return 'react';
            }
            if (/[\\/]node_modules[\\/](socket\.io-client|engine\.io-client|socket\.io-parser)[\\/]/.test(id)) {
              return 'realtime';
            }
            return undefined;
          },
        },
      },
    },
  };
});
