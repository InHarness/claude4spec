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
 *
 * 0.1.134→next — zod facade. The host's own `z` is re-exported below as a VALUE for
 * the same single-instance reason as the MCP builders: a plugin's backend schema code
 * must build entity CRUD/`mcpTool` schemas with the host's `z` so the host can
 * introspect them via `z.toJSONSchema()` (a zod v4 walker over each node's `.def`).
 * See the inline note at the export for the failure mode this closes and the v4 caveat.
 *
 * Runtime resolution of these VALUES, by consumer:
 *   - In-repo built-ins import this barrel by relative path (`../../plugin-runtime`).
 *   - External backend plugins import the bare alias `@c4s/plugin-runtime`, which
 *     0.1.134 binds in Node: the M33 loader installs a host-owned resolve hook at
 *     bootstrap (`core/plugin-host/plugin-runtime-resolver.ts`) that points the alias
 *     at THIS barrel — the same URL the built-ins resolve to, so both ends share one
 *     live instance. This is the backend counterpart of the frontend import-map
 *     shim, which serves the (disjoint) client value surface for the same alias.
 *   - The package SUBPATH `@inharness-ai/claude4spec/plugin-runtime` also resolves
 *     here via `exports["./plugin-runtime"].default` — the fallback when the
 *     resolver can't install (node <20.6, which `engines.node: ">=20"` still admits).
 *     Prefer the bare alias: in dev the subpath resolves to `dist/` while the host
 *     runs from `src/`, which is a second copy of this barrel.
 */

export { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';
// MCP builder facade (0.1.133) — VALUES re-exported from the internal vendor.
export { createMcpServer, mcpTool } from '@inharness-ai/agent-adapters';
// zod facade (0.1.134→next) — the host's OWN `z` re-exported as a VALUE. A plugin's
// backend schema code (the `backend.crud` create/update schemas, a custom
// `backend.mcpServer`'s `mcpTool` shapes) must build with THIS `z`, not a bundled
// `import { z } from 'zod'`: the host introspects those schemas with `z.toJSONSchema()`
// (a zod v4 API), which walks each node's internal `.def`. A schema built by a second
// zod instance has no v4-shaped `.def` and the walker throws
// `Cannot read properties of undefined (reading 'def')` — the "two vendor copies in one
// process" failure #89 removed for the runtime facade, here closed for zod. This barrel
// is the single instance both the host and a facade-importing plugin resolve to, so the
// shared `z` is one instance process-wide. NOTE: the host is on **zod v4** — a plugin
// written against v3 backend-schema APIs may need adjustment once it shares this `z`.
export { z } from 'zod';
export type { ZodRawShape } from 'zod';
// Host-internal concrete handle types for in-repo backend consumers. NOT part of
// the published `@c4s/plugin-runtime` surface (that shows opaque `McpServerFactory`).
// `McpToolDefinition` is what `mcpTool()` returns — an entity module that splits
// "build the tool list" from "wrap it in a server" (so the tools stay unit-testable)
// needs to name that type without reaching past this facade.
export type { McpServerInstance, McpToolDefinition } from '@inharness-ai/agent-adapters';
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
