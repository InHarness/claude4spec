// M33: publish the host's live singletons onto window.__c4s_shared FIRST, so the
// import-map shims can hand the exact same React / Tiptap / QueryClient instances
// to any runtime plugin. Must precede React-dependent imports below.
import './runtime/shared-runtime.js';
// M51 — the host modules' XML tags and their browser-side renders, before anything parses.
import './xml-markup/host-renders.js';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { createAppRouter } from './router.js';
import { PROJECT_ID } from './lib/api-core.js';
import './entities/index.js';
import { clientPluginHost } from './core/plugin-host/host.js';
import { mountFrontend } from './tiptap/mountFrontend.js';
import { queryClient } from './runtime/query-client.js';
import { bootFrontendPlugins, seedPluginActivation } from './runtime/boot-plugins.js';
import './styles/index.css';
import 'highlight.js/styles/atom-one-dark.css';

// Seed plugin host activation before React mounts. Failure is non-fatal —
// host falls back to "all available active". A workspace route (`/welcome`,
// M50 `1bd92aq2`) runs project-less by construction (PROJECT_ID=''), where
// `apiFetch` cannot build a `/api/projects/<id>` prefix — `seedPluginActivation`
// skips the request there and applies the same fallback at once.
const activationSeeded = seedPluginActivation();

const router = createAppRouter(queryClient);

// M33 phase 3: mount the SYNCHRONOUSLY-registered built-in entity modules' page
// routes (e.g. the transitional `database-table` fragment) as soon as the
// project's activation list is in — `mountFrontend` mounts only ACTIVE modules
// (M13 `m13actv0`). A deep link that lands before then waits on the boot window
// (`pluginBootPending`) instead of rendering "not found". A workspace document
// mounts no entity route (`routesForDocument`), so it skips the mount — the
// ordinary path there (M13 `mbladez6` client step 1b), not an edge case.
if (PROJECT_ID) {
  void activationSeeded.then(() => mountFrontend(router, clientPluginHost.listEntities()));
}

// M33: load runtime plugins WITHOUT blocking first paint (the import map is
// injected server-side). This re-runs `mountFrontend` once the manifest
// resolves — idempotent, rebuilding the route tree from the frozen base so the
// built-in routes above are not duplicated.
//
// L8 ordering invariant (`m33l8wir`): a deep link CAN mount an editor before
// this boot settles, and Tiptap freezes its schema at create. The editors
// therefore follow the registry's schema version and re-initialise themselves
// when a schema-bearing extension lands (`tiptap/useEditorSchema.ts`) — the
// spec's "re-initialise live instances" implementation, so this call may stay
// non-blocking.
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
