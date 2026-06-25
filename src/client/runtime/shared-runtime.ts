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
