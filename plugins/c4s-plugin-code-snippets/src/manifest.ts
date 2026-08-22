import type { PluginManifest } from '@c4s/plugin-runtime';
import { codeSnippetCommands } from './capabilities/commands.js';
import { codeSnippetEntity } from './entity/code-snippet/index.js';

/**
 * The envelope's manifest.
 *
 * `hostApiVersion: '^2.0.0'` is not boilerplate: the loader's version gate
 * `continue`s BEFORE `registerPlugin`, so a mismatch does not fail loudly — the
 * package simply is not there. No type, no slash command, and a single
 * `PLUGIN_HOST_API_MISMATCH` line in the log as the only evidence.
 *
 * No `onUnregister`: that slot covers a plugin's OWN resources — a timer, a
 * watcher, a connection opened by an imperative `backend.mount` — and this
 * package, having no `backend` at all, has none of them. Unwiring the type is
 * the host's `registry.unregisterPlugin` plus the `ProjectContext` rebuild.
 */
export const manifest: PluginManifest = {
  name: 'c4s-plugin-code-snippets',
  version: '0.2.45',
  hostApiVersion: '^2.0.0',
  engines: { node: '>=20' },
  contributes: {
    entities: [codeSnippetEntity],
    commands: codeSnippetCommands,
  },
};
