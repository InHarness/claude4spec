/**
 * `@c4s/plugin-runtime` — backend half.
 *
 * The single, versioned surface a runtime plugin's server code (its
 * `backend.mount(ctx)`) compiles against, instead of reaching into deep host
 * paths. On the backend the host singletons are shared in-process; this module
 * re-exports the stable contract pieces.
 *
 * Phase 1 has no plugin packages, so nothing imports this yet — it exists so the
 * contract surface is in place and stable for phase 2 (when project-local
 * plugins under `.claude4spec/plugins/` link against it). The frontend half of
 * `@c4s/plugin-runtime` lives in `src/client/runtime/plugin-runtime.ts` and is
 * delivered to plugins through the import-map shim.
 *
 * 0.1.133 — MCP builder facade. `createMcpServer` / `mcpTool` are re-exported as
 * VALUES here so a plugin's custom `backend.mcpServer` server compiles and runs
 * against `@c4s/plugin-runtime`, never reaching into the vendor
 * `@inharness-ai/agent-adapters` directly. The vendor is an internal host
 * dependency hidden behind this facade: the PUBLISHED type surface
 * (`plugin-types/plugin-runtime.ts`, routed via `exports.types`) shows only the
 * C4S-owned opaque `McpServerFactory` handle, so vendor config shapes never leak
 * and a vendor version bump does not bump `hostApiVersion` while the facade shape
 * holds. Host-internal backend consumers (the built-in entity modules) import the
 * builders from this barrel and keep the concrete vendor `McpServerInstance` type
 * re-exported below — that concrete type is host-internal, not published.
 */

export { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';
// MCP builder facade (0.1.133) — VALUES re-exported from the internal vendor.
export { createMcpServer, mcpTool } from '@inharness-ai/agent-adapters';
// Host-internal concrete handle type for in-repo backend consumers. NOT part of
// the published `@c4s/plugin-runtime` surface (that shows opaque `McpServerFactory`).
export type { McpServerInstance } from '@inharness-ai/agent-adapters';
export type {
  PluginManifest,
  EntityContribution,
  PluginEngines,
} from '../../shared/plugin-host/manifest.js';
export type {
  PluginRegistry,
  ProjectPluginHost,
  BackendModule,
  MountContext,
  PluginMountFn,
} from '../core/plugin-host/types.js';
