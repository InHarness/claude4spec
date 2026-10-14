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
 * 2.1.20: the client compares no versions. The manifest is filtered on the
 * server — it announces only plugins whose backend is `loaded` after the
 * host-API / engines gate — and its `importMap` is an informational copy the
 * client does not read (the server injected the real one). Each entry is
 * imported from its absolute `plugins[].entry` URL.
 *
 * 2.1.22 (M33 `m33l5man`, M13 `mbladez6` client step 1b): the manifest is the
 * one of THIS tab's project (`window.__C4S_PROJECT__.id`). A document without
 * that global runs no plugin frontends: no manifest request, no fallback id in
 * a URL — the client registry holds the built-in types only. A failed manifest
 * request leaves the host running without plugin frontends. An entry already
 * imported in this tab is never imported a second time: when a refetched
 * manifest changes it, or a hot-reload rebuilt it, the document reloads once
 * the editors have nothing unsaved (`document-reload.ts`).
 */

import { metaApi, pluginsApi } from '../lib/api.js';
import { PROJECT_ID } from '../lib/api-core.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { mountFrontend } from '../tiptap/mountFrontend.js';
import { registerPluginCommands } from '../tiptap/pluginCommands.js';
import { sharedRuntimeReady } from './shared-runtime.js';
import { requestDocumentReload } from './document-reload.js';
import type { AppRouter } from '../router.js';
import type { FrontendManifestResponse } from '../../shared/plugin-host/frontend-manifest.js';

/**
 * Module-level handle to the live router, captured by `bootFrontendPlugins` so a
 * later WS-driven `reloadFrontendPlugins()` (no router argument available there)
 * can re-mount routes onto the SAME router instance.
 */
let activeRouter: AppRouter | null = null;

function injectCssOnce(href: string): void {
  if (document.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

/**
 * Entries imported in this tab, by plugin name. An ES module cannot be unloaded
 * and a second `import()` of the same URL returns the module already loaded, so
 * this map is what the tab really runs — the reference a refetched manifest is
 * compared against.
 */
const importedEntries = new Map<string, string>();

/** Test/diagnostic view of the entries this tab imported (name → entry URL). */
export function importedPluginEntries(): ReadonlyMap<string, string> {
  return importedEntries;
}

/** Loads one entry. A seam so tests can watch imports without a module server. */
const nativeImport = (entry: string): Promise<unknown> =>
  // @vite-ignore — runtime URL, must not be analyzed/bundled by Vite.
  import(/* @vite-ignore */ entry);
let importEntry: (entry: string) => Promise<unknown> = nativeImport;

/** Test seam: replace the entry importer (`null` restores native `import()`). */
export function __setPluginEntryImporter(importer: ((entry: string) => Promise<unknown>) | null): void {
  importEntry = importer ?? nativeImport;
}

/** Whether an entry URL is a project-local overlay asset (vs. the base tier). */
function entryTier(entry: string): 'base' | 'overlay' {
  return entry.startsWith('/api/projects/') ? 'overlay' : 'base';
}

/**
 * Import every newly announced plugin entry + pin its editor slots. An entry
 * this tab already imported is not imported again: the same URL resolves to the
 * loaded module, and a DIFFERENT `entry` for an imported plugin (e.g. trust now
 * lets an overlay shadow the npm package, or stops it) cannot replace the module
 * in place — it requests a document reload instead (M33 `m33l5man`). Returns
 * nothing — slots land on `clientPluginHost` via `@c4s/plugin-runtime`, then
 * `mountFrontend` pins them into the shared registry.
 */
async function loadManifestPlugins(manifest: FrontendManifestResponse, router: AppRouter): Promise<void> {
  for (const plugin of manifest.plugins) {
    const imported = importedEntries.get(plugin.name);
    if (imported !== undefined) {
      if (imported !== plugin.entry) {
        requestDocumentReload(`plugin "${plugin.name}" frontend entry changed (${imported} → ${plugin.entry})`);
      }
      continue;
    }
    if (plugin.css) injectCssOnce(plugin.css);
    try {
      await importEntry(plugin.entry);
      importedEntries.set(plugin.name, plugin.entry);
    } catch (err) {
      console.warn(`[plugin-host] failed to import plugin "${plugin.name}" (${plugin.entry})`, err);
    }
  }
  // Pin editor extensions + XML embeds + page routes for everything that registered.
  mountFrontend(router, clientPluginHost.listEntities());
}

/**
 * Register the declarative `contributes.commands` of loaded+trusted plugins.
 *
 * Project-scoped: on the project-less `/welcome` (Decision #11, PROJECT_ID='')
 * there is no `/api/projects/<id>` prefix for `apiFetch` to build, so the call
 * would 404 — and since 0.1.137 `/welcome` is the unconditional root landing,
 * that would greet every start. Nothing there can host a plugin command anyway.
 */
async function registerProjectPluginCommands(): Promise<void> {
  if (!PROJECT_ID) return;
  try {
    const { commands } = await metaApi.pluginCommands();
    // 0.2.29 — `registerPluginCommands` REPLACES the whole `plugin-cmd:`
    // namespace, so a malformed 200 (no `commands` array) would wipe every
    // plugin trigger from the slash menu and then throw into the catch below,
    // leaving the menu emptier than before the refetch. Only a well-formed list
    // is allowed to stand in for the current state of the pool.
    if (!Array.isArray(commands)) {
      console.warn('[plugin-host] /_meta/plugin-commands returned no command list; keeping the current set');
      return;
    }
    registerPluginCommands(commands);
  } catch (err) {
    console.warn('[plugin-host] failed to fetch plugin commands', err);
  }
}

/**
 * Whether the first plugin boot is still in flight.
 *
 * The boot deliberately does not block first paint, which leaves a window where
 * a plugin-contributed route does not exist yet. Before 0.2.2 that window only
 * covered `/database-tables`; now it covers `/endpoints` and `/dtos` too, so a
 * hard refresh on one of those deep links would render "not found" and then
 * quietly become correct a moment later — which reads as a broken link, not as
 * loading. The router's `defaultNotFoundComponent` consults this to tell the
 * two apart. Resolves (never rejects) once the boot has settled either way.
 */
let bootSettled = false;
let resolveBoot: (() => void) | undefined;
export const frontendPluginsBooted: Promise<void> = new Promise((resolve) => {
  resolveBoot = resolve;
});

/** True until the first `bootFrontendPlugins` call settles. */
export function pluginBootPending(): boolean {
  return !bootSettled;
}

function settleBoot(): void {
  bootSettled = true;
  resolveBoot?.();
}

export async function bootFrontendPlugins(router: AppRouter): Promise<void> {
  activeRouter = router;
  try {
    await bootFrontendPluginsInner(router);
  } finally {
    // A failed boot still ends the window: whatever was missing is not coming,
    // and holding a spinner forever is worse than an honest 404.
    settleBoot();
  }
}

async function bootFrontendPluginsInner(router: AppRouter): Promise<void> {
  // The lucide-react peer is code-split (see shared-runtime.ts) — wait for it
  // to land on window.__c4s_shared before any plugin entry can reach the shim.
  await sharedRuntimeReady;
  // No project global (a route outside a project, a stale document): step 1b is
  // skipped — no manifest request, no substitute id in the URL.
  if (!PROJECT_ID) return;
  let manifest: FrontendManifestResponse;
  try {
    manifest = await pluginsApi.frontendManifest();
  } catch (err) {
    console.warn('[plugin-host] failed to fetch frontend manifest — running without plugins', err);
    return;
  }
  await loadManifestPlugins(manifest, router);
  await registerProjectPluginCommands();
}

/**
 * M33 (`m33l7pln` step 5) — react to a `plugin:reloaded` WS event.
 *
 * Refetch the manifest of this tab's project and import the frontends it newly
 * announces (re-pinning editor extensions and commands). A frontend already
 * imported in the tab is never imported again: when the event names a plugin
 * whose frontend this tab imported — from the tier the event comes from — the
 * hot-reload rebuilt it, and the document reloads instead, once no editor holds
 * unsaved changes (`m33l5man`). Until then the frontend loaded earlier keeps
 * working. A changed `entry` in the refetched manifest takes the same path
 * (`loadManifestPlugins`).
 */
export async function reloadFrontendPlugins(
  reloaded?: { name: string; tier?: 'base' | 'overlay' },
): Promise<void> {
  if (!activeRouter) {
    console.warn('[plugin-host] plugin reload before boot — no router captured; skipping');
    return;
  }
  if (!PROJECT_ID) return;
  if (reloaded) {
    const imported = importedEntries.get(reloaded.name);
    if (imported !== undefined && (reloaded.tier === undefined || entryTier(imported) === reloaded.tier)) {
      requestDocumentReload(`plugin "${reloaded.name}" frontend was rebuilt`);
    }
  }
  let manifest: FrontendManifestResponse;
  try {
    manifest = await pluginsApi.frontendManifest();
  } catch (err) {
    console.warn('[plugin-host] plugin reload — manifest refetch failed', err);
    return;
  }
  await loadManifestPlugins(manifest, activeRouter);
  await registerProjectPluginCommands();
}

/**
 * 2.1.16 (M50 `8h2a734u`) — re-read the project's plugin activation in THIS tab,
 * without a page reload and without a server restart.
 *
 * Called after a save on Settings → Entities (the `entity-types` element's
 * `afterSave`). It re-seeds the host's activation from `GET /api/_meta/entities`,
 * refetches the frontend manifest and imports what is new. (A Trust plugins
 * answer does not use it: it swaps the overlay layer — commands, settings,
 * shadowing — so the server's `project:disposed` reloads the page instead.) No cache-bust: an entry this tab already imported resolves to the
 * module it has, so only the newly advertised frontends load. `mountFrontend`
 * then re-pins the routes, so a re-activated type gets its tab AND its route.
 *
 * Deliberately NOT wired to any WS event: a change saved in another browser tab
 * or a hand edit of `config.json` leaves this tab's ELEMENTS as they are until
 * the page is reloaded (M50 `6z6uzzhv`).
 */
export async function refreshPluginActivation(router: AppRouter | null = activeRouter): Promise<void> {
  clientPluginHost.applyActivation(await metaApi.entities());
  if (!router) return;
  activeRouter = router;
  if (!PROJECT_ID) {
    mountFrontend(router, clientPluginHost.listEntities());
    return;
  }
  let manifest: FrontendManifestResponse;
  try {
    manifest = await pluginsApi.frontendManifest();
  } catch (err) {
    console.warn('[plugin-host] activation refresh — manifest refetch failed', err);
    mountFrontend(router, clientPluginHost.listEntities());
    return;
  }
  await loadManifestPlugins(manifest, router);
}
