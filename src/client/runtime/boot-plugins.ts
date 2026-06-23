/**
 * M33 client boot sequence ("Option B").
 *
 * Runs once at startup, fired non-blocking from main.tsx (after
 * `shared-runtime.ts` has published the host singletons). The import map itself
 * is injected server-side into the page `<head>` (deterministic — present before
 * any module resolves), so this loader only:
 *   1. fetches the frontend manifest (non-fatal),
 *   2. injects each plugin's CSS (order preserved, idempotent),
 *   3. `await import(entry)` per active plugin — the module hands its slots to
 *      `clientPluginHost` via `@c4s/plugin-runtime`,
 *   4. calls `mountFrontend` to pin editor extensions + XML embeds.
 *
 * A per-plugin host-API gate (mirror of the backend skip) is added once
 * `PluginFrontendEntry` carries a version. No plugin packages ship yet, so
 * the manifest's `plugins` is empty and every step is a no-op — but the full
 * path is exercised end-to-end.
 */

import { metaApi, pluginsApi } from '../lib/api.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { mountFrontend } from '../tiptap/mountFrontend.js';
import { registerPluginCommands } from '../tiptap/pluginCommands.js';
import type { FrontendManifestResponse } from '../../shared/plugin-host/frontend-manifest.js';

function injectCssOnce(href: string): void {
  if (document.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

/**
 * Import every active plugin entry + pin its editor slots. On reload (`bust`),
 * append the entry's own `version` as the cache-bust token rather than a
 * timestamp: this re-imports a fresh module when the plugin version changes
 * (the overlay loader re-reads `manifest.version` on rebuild) while staying
 * BOUNDED — repeated reloads of the same version reuse one module URL instead
 * of leaking a new one each time. (A content hash in the server-served entry
 * URL is the ideal long-term key, once project-local frontend delivery lands.)
 * Returns nothing — slots land on `clientPluginHost` via `@c4s/plugin-runtime`,
 * then `mountFrontend` pins them into the shared registry.
 */
async function loadManifestPlugins(manifest: FrontendManifestResponse, bust = false): Promise<void> {
  for (const href of manifest.css ?? []) injectCssOnce(href);
  for (const plugin of manifest.plugins) {
    if (plugin.css) injectCssOnce(plugin.css);
    const suffix = bust ? `?v=${encodeURIComponent(plugin.version)}` : '';
    try {
      // @vite-ignore — runtime URL, must not be analyzed/bundled by Vite.
      await import(/* @vite-ignore */ plugin.entry + suffix);
    } catch (err) {
      console.warn(`[plugin-host] failed to import plugin "${plugin.name}" (${plugin.entry})`, err);
    }
  }
  // Pin editor extensions + XML embeds for everything that registered.
  mountFrontend(clientPluginHost.listEntities());
}

/** Register the declarative `contributes.commands` of loaded+trusted plugins. */
async function registerProjectPluginCommands(): Promise<void> {
  try {
    const { commands } = await metaApi.pluginCommands();
    registerPluginCommands(commands);
  } catch (err) {
    console.warn('[plugin-host] failed to fetch plugin commands', err);
  }
}

export async function bootFrontendPlugins(): Promise<void> {
  let manifest: FrontendManifestResponse;
  try {
    manifest = await pluginsApi.frontendManifest();
  } catch (err) {
    console.warn('[plugin-host] failed to fetch frontend manifest — running without plugins', err);
    return;
  }
  await loadManifestPlugins(manifest);
  await registerProjectPluginCommands();
}

/**
 * M33 — react to a `plugin:reloaded` WS event WITHOUT a page reload.
 * Refetch the frontend-manifest, re-import each entry with a cache-bust, re-pin
 * editor extensions, and re-register declarative commands. Crucially this NEVER
 * touches ProseMirror document state (no `setContent`), so an open/unsaved
 * document survives the extension remount; a live editor re-applies the shared
 * registry on the `c4s:plugins-reloaded` event dispatched by the caller.
 */
export async function reloadFrontendPlugins(): Promise<void> {
  let manifest: FrontendManifestResponse;
  try {
    manifest = await pluginsApi.frontendManifest();
  } catch (err) {
    console.warn('[plugin-host] plugin reload — manifest refetch failed', err);
    return;
  }
  await loadManifestPlugins(manifest, true);
  await registerProjectPluginCommands();
}
