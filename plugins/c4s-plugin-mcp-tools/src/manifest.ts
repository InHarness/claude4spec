import type { PluginManifest } from '@c4s/plugin-runtime';
import { mcpToolEntity } from './entity/mcp-tool/index.js';

/**
 * The envelope's manifest.
 *
 * `hostApiVersion: '^2.0.0'` is not boilerplate: the loader's version gate
 * `continue`s BEFORE `registerPlugin`, so a mismatch does not fail loudly — the
 * package simply is not there. No type, no tab, no routes, and a single
 * `PLUGIN_HOST_API_MISMATCH` line in the log as the only evidence.
 *
 * `contributes.entities` is the whole of it. No `commands`: the brief rules out
 * a `/mcp-tool` slash command, because a tool is not authored "in flight" in
 * prose the way a diagram is — it is written while describing its server, from
 * the list screen. (That is a statement about the EDITOR path only; the visible
 * type still gets an ordinary Create button on its list. The two are different
 * doors and only one of them is closed.)
 *
 * No `onUnregister`: the slot covers a plugin's OWN resources — a timer, a
 * watcher, a connection opened by an imperative `backend.mount` — and this
 * package, having no `backend` at all, has none of them. Unwiring the type is
 * the host's `registry.unregisterPlugin` plus the `ProjectContext` rebuild.
 */
export const manifest: PluginManifest = {
  name: 'c4s-plugin-mcp-tools',
  version: '0.2.33',
  hostApiVersion: '^2.0.0',
  engines: { node: '>=20' },
  contributes: {
    entities: [mcpToolEntity],
  },
};
