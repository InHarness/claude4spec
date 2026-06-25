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
import { mountFrontend } from './tiptap/mountFrontend.js';
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

const router = createAppRouter(queryClient);

// M33 phase 3: mount the SYNCHRONOUSLY-registered built-in entity modules' page
// routes (e.g. the transitional `database-table` fragment) onto the router BEFORE
// first paint, so a deep link to a built-in route doesn't hit a 404 window while
// the async plugin boot is still in flight.
mountFrontend(router, clientPluginHost.listEntities());

// M33: load runtime plugins WITHOUT blocking first paint (the import map is
// injected server-side and the editor isn't mounted on first paint). This
// re-runs `mountFrontend` once the manifest resolves — idempotent, rebuilding the
// route tree from the frozen base so the built-in routes above are not duplicated.
void bootFrontendPlugins(router).catch((err) => {
  console.warn('[plugin-host] plugin boot failed', err);
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing from index.html');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
