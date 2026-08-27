import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import '@/styles/globals.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Register the offline service worker.
 *
 * Only in production builds: the worker is generated at build time, so in dev
 * there is nothing to register, and a stale worker would shadow HMR.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // Registration fails on insecure origins and in some private modes. The
      // app still runs; it just will not survive a reload without network.
      console.warn('Envelop: offline support unavailable', error);
    });
  });
}
