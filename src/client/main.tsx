import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { createAppRouter } from './router.js';
import './entities/index.js';
import { clientPluginHost } from './core/plugin-host/host.js';
import { metaApi } from './lib/api.js';
import './styles/index.css';
import 'highlight.js/styles/atom-one-dark.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// Seed plugin host activation before React mounts. Failure is non-fatal —
// host falls back to "all available active" so legacy code paths keep working.
metaApi
  .entities()
  .then((state) => clientPluginHost.applyActivation(state))
  .catch((err) => {
    console.warn('[plugin-host] failed to fetch /api/_meta/entities — assuming all active', err);
    clientPluginHost.applyActivation(null);
  });

const router = createAppRouter(queryClient);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing from index.html');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
