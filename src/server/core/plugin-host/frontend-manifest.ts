/**
 * M33: build the `GET /api/plugins/frontend-manifest` payload.
 *
 * Phase 1 emits the fixed peer import map + host API version and an EMPTY
 * `plugins[]` (no backend module declares a frontend entry yet). The plumbing
 * still stands up so the client boot loader, import map, and shims are exercised
 * end-to-end. Takes the registry as an argument so phase 2 can pass a
 * project-scoped view (project-local overlay) without an API change.
 */

import { HOST_API_VERSION } from '../../../shared/plugin-host/manifest.js';
import type {
  FrontendManifestResponse,
  PluginFrontendEntry,
} from '../../../shared/plugin-host/frontend-manifest.js';
import { buildImportMap } from './runtime-shims.js';
import type { PluginRegistry } from './types.js';

export function buildFrontendManifest(_registry: PluginRegistry): FrontendManifestResponse {
  // Phase 1: no backend module carries a frontend ESM entry, so plugins is [].
  // When a plugin contributes a frontend, emit `{ name, version,
  // entry: '/api/plugins/<name>/frontend.js', css }` here.
  const plugins: PluginFrontendEntry[] = [];

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
