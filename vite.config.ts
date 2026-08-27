import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { serviceWorkerPlugin } from './build/service-worker-plugin';

export default defineConfig({
  plugins: [
    react(),
    // Precaches the whole build so the app keeps working with no network.
    serviceWorkerPlugin({
      cacheName: 'envelop',
      additional: ['/engine/envelop.wasm', '/favicon.svg'],
    }),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        // Split heavy vendors so first paint is not blocked by Monaco or Three.
        manualChunks: {
          react: ['react', 'react-dom'],
          three: ['three'],
          charts: ['recharts'],
          rete: ['rete', 'rete-area-plugin', 'rete-connection-plugin', 'rete-react-plugin'],
        },
      },
    },
  },
});
