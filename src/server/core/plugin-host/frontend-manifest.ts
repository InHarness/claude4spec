/**
 * M33: build the `GET /api/plugins/frontend-manifest` payload (2.1.20).
 *
 * The manifest is filtered HERE, on the server: `plugins[]` announces exactly the
 * effective frontend pool of `frontend-assets.ts` — sources whose backend is
 * `loaded` after the `hostApiVersion` / `engines` gate, one per name with the
 * overlay > npm package > envelope precedence. The client compares no versions.
 *
 * `importMap` is an informational copy of the map the server injects into the
 * page (`injectImportMap` in `server/index.ts`): the host's peer shims and both
 * runtime specifiers, with no plugin entries — a plugin entry is imported from
 * its absolute `plugins[].entry` URL.
 */

import path from 'node:path';
import { HOST_API_VERSION } from '../../../shared/plugin-host/manifest.js';
import type {
  FrontendManifestResponse,
  PluginFrontendEntry,
} from '../../../shared/plugin-host/frontend-manifest.js';
import { buildImportMap } from './runtime-shims.js';
import { effectiveFrontendSources, type FrontendPool, type FrontendSource } from './frontend-assets.js';

/**
 * One source → its manifest entry. The route is `/api/plugins/:name/:asset`, one
 * path segment per part: a scoped name (`@scope/pkg`) is percent-encoded into a
 * single segment (Express decodes `:name` back). The entry's file name is the
 * resolved entry's own (e.g. `exports['./frontend']` → `./out/client.js` gives
 * `client.js`), so the route serves exactly the file the rule picked.
 */
function toEntry(src: FrontendSource): PluginFrontendEntry {
  const base = `/api/plugins/${encodeURIComponent(src.name)}/`;
  return {
    name: src.name,
    version: src.version,
    entry: base + encodeURIComponent(path.basename(src.entry)),
    ...(src.css ? { css: base + 'frontend.css' } : {}),
  };
}

/** Build the boot manifest from the effective frontend pool. */
export function buildFrontendManifest(pool: FrontendPool = {}): FrontendManifestResponse {
  return {
    hostApiVersion: HOST_API_VERSION,
    importMap: buildImportMap(),
    plugins: effectiveFrontendSources(pool).map(toEntry),
  };
}
