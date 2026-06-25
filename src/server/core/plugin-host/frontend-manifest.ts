/**
 * M33: build the `GET /api/plugins/frontend-manifest` payload.
 *
 * Emits the fixed peer import map + host API version and the active plugins to
 * boot ("Option B"). Phase 2: when the process's primary project is trusted,
 * `plugins[]` lists its project-local plugins that ship a built
 * `.claude4spec/plugins/<name>/dist/frontend.js` — each pointing the client at
 * the serving routes in `routes/plugins.ts`. Untrusted/absent ⇒ `plugins: []`,
 * so the import map + shim plumbing still stands up end-to-end with nothing to load.
 */

import { HOST_API_VERSION } from '../../../shared/plugin-host/manifest.js';
import type {
  FrontendManifestResponse,
  PluginFrontendEntry,
} from '../../../shared/plugin-host/frontend-manifest.js';
import { buildImportMap } from './runtime-shims.js';
import { enumerateFrontendBundles } from './frontend-assets.js';
import type { PluginRegistry } from './types.js';

/**
 * Serving context for the process's primary project. Absent on workspace-only
 * starts (nothing registered) ⇒ no project-local frontends are advertised.
 */
export interface FrontendManifestServing {
  cwd: string;
  /** `trustProjectPlugins === true` for the primary project. Untrusted ⇒ no plugins. */
  trusted: boolean;
}

export function buildFrontendManifest(
  _registry: PluginRegistry,
  serving?: FrontendManifestServing,
): FrontendManifestResponse {
  // Project-local plugins (axis: a trusted project with a built frontend bundle).
  // Each resolves to the phase-2 serving routes; CSS only when `dist/frontend.css`
  // exists, so a style-less plugin omits `css` and the client never fetches it.
  const plugins: PluginFrontendEntry[] =
    serving?.trusted
      ? enumerateFrontendBundles(serving.cwd).map((b) => ({
          name: b.name,
          version: b.version,
          entry: `/api/plugins/${b.name}/frontend.js`,
          ...(b.hasCss ? { css: `/api/plugins/${b.name}/frontend.css` } : {}),
        }))
      : [];

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
