/**
 * M33: build the `GET /api/plugins/frontend-manifest` payload.
 *
 * Emits the fixed peer import map + host API version and the active plugins to
 * boot ("Option B"). Two tiers feed `plugins[]` (see `buildFrontendManifest`):
 * the workspace/npm tier (ungated, every project) and the project-local overlay
 * tier (only when the primary project is trusted) — each pointing the client at
 * the serving routes in `routes/plugins.ts`. No tiers active ⇒ `plugins: []`, so
 * the import map + shim plumbing still stands up end-to-end with nothing to load.
 */

import { HOST_API_VERSION } from '../../../shared/plugin-host/manifest.js';
import type {
  FrontendManifestResponse,
  PluginFrontendEntry,
} from '../../../shared/plugin-host/frontend-manifest.js';
import { buildImportMap } from './runtime-shims.js';
import {
  enumerateFrontendBundles,
  enumerateWorkspaceFrontendBundles,
  type FrontendBundle,
  type WorkspaceRootResolver,
} from './frontend-assets.js';
import type { PluginRegistry } from './types.js';

/**
 * Serving context for the process's primary project. Absent on workspace-only
 * starts (nothing registered) ⇒ only workspace-tier frontends are advertised.
 */
export interface FrontendManifestServing {
  cwd: string;
  /** `trustProjectPlugins === true` for the primary project. Untrusted ⇒ no overlay plugins. */
  trusted: boolean;
}

/** One bundle → the manifest entry pointing at the (tier-agnostic) serving routes. */
function toEntry(b: FrontendBundle): PluginFrontendEntry {
  // The serving route is `/api/plugins/:name/:asset` — a single path segment for
  // the name. A SCOPED package (`@scope/pkg`) contains a `/`, so it MUST be
  // percent-encoded to stay one segment (the route decodes `:name` back via
  // Express param decoding). Without this a scoped plugin's frontend URL gains an
  // extra segment, the route never matches → 404 → no frontend loads → no sidebar
  // entry. The browser preserves the encoded segment when resolving the bundle's
  // relative code-split siblings (`./chunk.js`), so those resolve too.
  const seg = encodeURIComponent(b.name);
  return {
    name: b.name,
    version: b.version,
    entry: `/api/plugins/${seg}/frontend.js`,
    ...(b.hasCss ? { css: `/api/plugins/${seg}/frontend.css` } : {}),
  };
}

/**
 * Build the boot manifest. `plugins[]` is base ∪ overlay:
 *   • workspace tier (`workspacePackages`) — ALWAYS advertised, ungated (a base
 *     npm install is trusted), present for every project of the process; and
 *   • overlay tier — the primary project's project-local bundles, ONLY when that
 *     project is trusted.
 * De-duped by `name`: an overlay bundle overrides a workspace bundle of the same
 * name (the project-local copy wins). CSS only when the bundle ships it, so a
 * style-less plugin omits `css` and the client never fetches it.
 */
export function buildFrontendManifest(
  _registry: PluginRegistry,
  serving?: FrontendManifestServing,
  workspacePackages: readonly string[] = [],
  workspaceRootResolver?: WorkspaceRootResolver,
): FrontendManifestResponse {
  const byName = new Map<string, PluginFrontendEntry>();
  for (const b of enumerateWorkspaceFrontendBundles(workspacePackages, workspaceRootResolver))
    byName.set(b.name, toEntry(b));
  if (serving?.trusted) {
    for (const b of enumerateFrontendBundles(serving.cwd)) byName.set(b.name, toEntry(b));
  }
  const plugins: PluginFrontendEntry[] = [...byName.values()];

  // `importMap` is informational here (diagnostics / future non-head consumers).
  // The AUTHORITATIVE copy the browser uses is injected server-side into the SPA
  // `<head>` (see `injectImportMap` in server/index.ts) — both derive from the
  // same `buildImportMap()`, so the two channels cannot diverge.
  return {
    hostApiVersion: HOST_API_VERSION,
    importMap: buildImportMap(),
    plugins,
  };
}
