/**
 * M33: build a project's frontend manifest payload (2.1.20, per project 2.1.22).
 *
 * The manifest is filtered HERE, on the server: `plugins[]` announces exactly the
 * project's effective frontend pool of `frontend-assets.ts` — sources whose
 * backend is `loaded` after the `hostApiVersion` / `engines` gate, one per name
 * with the overlay > npm package > envelope precedence. The client compares no
 * versions. The manifest carries no project identity field: the project appears
 * only in the addresses of overlay entries.
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
 * The URL folder a source's assets are served from — one address per tier
 * (L11 `9g96q3pp`): the base tier on the process-global route, the same in the
 * manifest of every project; the overlay on the project route of `projectId`.
 * Each part is ONE path segment: a scoped name (`@scope/pkg`) is percent-encoded
 * (`/` → `%2F`), and Express decodes `:name` back. The project is a path segment,
 * not a query parameter, so a relative chunk import of the entry stays on the
 * same project's route.
 */
export function frontendAssetBase(src: FrontendSource, projectId: string): string {
  // `@` is a legal path character: keep `@scope%2Fpkg` readable (only `/` must be encoded).
  const name = encodeURIComponent(src.name).replace(/%40/g, '@');
  return src.kind === 'overlay'
    ? `/api/projects/${encodeURIComponent(projectId)}/plugins/${name}/`
    : `/api/plugins/${name}/`;
}

/**
 * One source → its manifest entry. The entry's file name is the resolved entry's
 * own (e.g. `exports['./frontend']` → `./out/client.js` gives `client.js`), so the
 * route serves exactly the file the rule picked. No content hash in the address:
 * freshness under a fixed address is the asset routes' revalidation (ETag, 304).
 */
function toEntry(src: FrontendSource, projectId: string): PluginFrontendEntry {
  const base = frontendAssetBase(src, projectId);
  return {
    name: src.name,
    version: src.version,
    entry: base + encodeURIComponent(path.basename(src.entry)),
    ...(src.css ? { css: base + 'frontend.css' } : {}),
  };
}

/** Build the boot manifest of project `projectId` from its effective frontend pool. */
export function buildFrontendManifest(projectId: string, pool: FrontendPool = {}): FrontendManifestResponse {
  return {
    hostApiVersion: HOST_API_VERSION,
    importMap: buildImportMap(),
    plugins: effectiveFrontendSources(pool).map((src) => toEntry(src, projectId)),
  };
}
