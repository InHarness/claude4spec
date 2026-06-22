// M33: publish the host's live singletons onto window.__c4s_shared FIRST, so the
// import-map shims can hand the exact same React / Tiptap / QueryClient instances
// to any runtime plugin. Must precede React-dependent imports below.
import './runtime/shared-runtime.js';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { createAppRouter } from './router.js';
import './entities/index.js';
import { clientPluginHost } from './core/plugin-host/host.js';
import { queryClient } from './runtime/query-client.js';
import { bootFrontendPlugins } from './runtime/boot-plugins.js';
import { metaApi } from './lib/api.js';
import './styles/index.css';
import 'highlight.js/styles/atom-one-dark.css';

// Seed plugin host activation before React mounts. Failure is non-fatal —
// host falls back to "all available active" so legacy code paths keep working.
metaApi
  .entities()
  .then((state) => clientPluginHost.applyActivation(state))
  .catch((err) => {
    console.warn('[plugin-host] failed to fetch /api/_meta/entities — assuming all active', err);
    clientPluginHost.applyActivation(null);
  });

async function bootstrap(): Promise<void> {
  // M33: load runtime plugins (import map already injected server-side) and pin
  // their editor extensions before the first editor is built. Non-fatal — phase
  // 1 ships no plugins, so this resolves immediately.
  await bootFrontendPlugins();

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
}

void bootstrap().catch((err) => {
  console.error('[bootstrap] fatal error during startup', err);
});
