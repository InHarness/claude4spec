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
 * `PluginFrontendEntry` carries a version. Phase 1 ships no plugin packages, so
 * the manifest's `plugins` is empty and every step is a no-op — but the full
 * path is exercised end-to-end.
 */

import { pluginsApi } from '../lib/api.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { mountFrontend } from '../tiptap/mountFrontend.js';
import type { FrontendManifestResponse } from '../../shared/plugin-host/frontend-manifest.js';

function injectCssOnce(href: string): void {
  if (document.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

export async function bootFrontendPlugins(): Promise<void> {
  let manifest: FrontendManifestResponse;
  try {
    manifest = await pluginsApi.frontendManifest();
  } catch (err) {
    console.warn('[plugin-host] failed to fetch frontend manifest — running without plugins', err);
    return;
  }

  // Host-level CSS first (deterministic cascade), then per-plugin CSS below.
  for (const href of manifest.css ?? []) injectCssOnce(href);

  // When PluginFrontendEntry grows a per-plugin `hostApiVersion`, gate here on a
  // major mismatch (mirror of the backend skip). Phase 1 carries no such field,
  // so every active manifest entry loads.
  for (const plugin of manifest.plugins) {
    if (plugin.css) injectCssOnce(plugin.css);
    try {
      // @vite-ignore — runtime URL, must not be analyzed/bundled by Vite.
      await import(/* @vite-ignore */ plugin.entry);
    } catch (err) {
      console.warn(`[plugin-host] failed to import plugin "${plugin.name}" (${plugin.entry})`, err);
    }
  }

  // Pin editor extensions + XML embeds for everything that registered.
  mountFrontend(clientPluginHost.listEntities());
}
