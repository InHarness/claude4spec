/**
 * M33 "Option B" — publish the host's OWN already-imported singletons.
 *
 * This module MUST be imported first in `main.tsx` (before anything that touches
 * a React-dependent singleton). It assigns the host's live module namespaces to
 * `window.__c4s_shared`. The import map points each peer specifier at a
 * server-served shim (`/api/plugins/runtime/<peer>.js`) that re-exports from this
 * global — so a plugin's `import "react"` resolves to the SAME React reconciler,
 * the SAME Tiptap schema, and the SAME QueryClient the host already uses. There
 * is no second copy: we publish exactly what the host bundle imported.
 */

import * as React from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import * as ReactJsxDevRuntime from 'react/jsx-dev-runtime';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as TiptapCore from '@tiptap/core';
import * as ReactQuery from '@tanstack/react-query';
import * as ReactRouter from '@tanstack/react-router';
import * as PluginRuntime from './plugin-runtime.js';
import * as PluginRuntimeUi from './plugin-runtime-ui.js';

declare global {
  // eslint-disable-next-line no-var
  var __c4s_shared: Record<string, unknown> | undefined;
}

globalThis.__c4s_shared = {
  react: React,
  'react/jsx-runtime': ReactJsxRuntime,
  'react/jsx-dev-runtime': ReactJsxDevRuntime,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  '@tiptap/core': TiptapCore,
  '@tanstack/react-query': ReactQuery,
  '@tanstack/react-router': ReactRouter,
  '@c4s/plugin-runtime': PluginRuntime,
  '@c4s/plugin-runtime/ui': PluginRuntimeUi,
};

/**
 * `lucide-react` (M33/0.1.121) is dynamically imported rather than statically
 * `import * as` like the peers above: unlike React/Tiptap it carries ~1,748
 * named icon exports, and a static wildcard import can't be tree-shaken once
 * assigned into an object literal, so it would inline the entire icon set into
 * this eagerly-loaded module's chunk even though the host itself only uses a
 * small subset directly. A dynamic `import()` lets the bundler code-split it
 * into its own chunk instead. This is safe to defer (unlike the peers above)
 * because the peer is gated curatorially, not for hook-correctness — lucide-react
 * has no reconciler/hook state that needs the exact same instance. Callers that
 * need the peer ready before booting plugins (`boot-plugins.ts`) await this.
 */
export const sharedRuntimeReady: Promise<void> = import('lucide-react').then((LucideReact) => {
  globalThis.__c4s_shared!['lucide-react'] = LucideReact;
});
