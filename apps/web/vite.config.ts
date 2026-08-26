import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // The repository root holds one .env for both the server and the web app.
  const env = loadEnv(mode, path.resolve(here, '../..'), '');

  return {
    plugins: [react(), tailwindcss()],
    envDir: path.resolve(here, '../..'),
    resolve: {
      alias: { '@': path.resolve(here, 'src') },
    },
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/api': { target: env.VITE_API_BASE_URL || 'http://localhost:4000', changeOrigin: true },
        '/socket.io': {
          target: env.VITE_API_BASE_URL || 'http://localhost:4000',
          ws: true,
          changeOrigin: true,
        },
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
