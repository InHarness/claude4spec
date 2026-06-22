/**
 * M33 client boot sequence ("Option B").
 *
 * Runs once at startup, after `shared-runtime.ts` has published the host
 * singletons and before React mounts. The import map itself is injected
 * server-side into the page `<head>` (deterministic — present before any module
 * resolves), so this loader only:
 *   1. fetches the frontend manifest (non-fatal),
 *   2. skips any plugin whose host-API major doesn't match the host,
 *   3. injects each plugin's CSS (order preserved, idempotent),
 *   4. `await import(entry)` per active plugin — the module hands its slots to
 *      `clientPluginHost` via `@c4s/plugin-runtime`,
 *   5. calls `mountFrontend` to pin editor extensions + XML embeds.
 *
 * Phase 1 ships no plugin packages, so the manifest's `plugins` is empty and
 * every step below is a no-op — but the full path is exercised end-to-end.
 */

import { pluginsApi } from '../lib/api.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { mountFrontend } from '../tiptap/mountFrontend.js';
import { HOST_API_VERSION, parseMajor } from '../../shared/plugin-host/manifest.js';
import type {
  FrontendManifestResponse,
  PluginFrontendEntry,
} from '../../shared/plugin-host/frontend-manifest.js';

function injectCssOnce(href: string): void {
  if (document.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function compatiblePlugins(manifest: FrontendManifestResponse): PluginFrontendEntry[] {
  const hostMajor = parseMajor(HOST_API_VERSION);
  // Phase 1 manifest carries no per-plugin host-API requirement; the gate is a
  // structural mirror of the backend skip so an omitted plugin stays omitted.
  // When PluginFrontendEntry grows a `hostApiVersion`, compare it here.
  void hostMajor;
  return manifest.plugins;
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

  const active = compatiblePlugins(manifest);
  for (const plugin of active) {
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
