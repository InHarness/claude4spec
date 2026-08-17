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
 * builders from this barrel and name the returned handle by the C4S-owned
 * `McpServerFactory` type re-exported below — 0.2.2 finished the job the 0.1.133
 * facade started, so the vendor's `McpServerInstance` no longer appears in the
 * host's OWN types either (only at the adapter boundary in `routes/agent-turn.ts`,
 * the code that actually hands the config to the adapter).
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
/**
 * 0.2.2 — `DomainError`, re-exported as a VALUE for the same single-instance
 * reason as the MCP builders and `z` below, but with a sharper failure mode:
 * the host narrows on it with `instanceof`, in the MCP `itemError` mapper
 * (`mcp/entity-tools.ts`) and in the global Express handler (`routes/errors.ts`).
 * A plugin that declares its own class satisfies every structural type-check and
 * still fails both narrowings at runtime — a `SLUG_CONFLICT` a plugin service
 * raises comes back to the caller as `INTERNAL`/500 instead of 409. Class
 * identity is not structural, so the ONLY way a plugin can raise an error the
 * host recognises is to throw this exact class.
 */
export { DomainError } from '../services/tags.js';
// MCP builder facade (0.1.133) — VALUES re-exported from the internal vendor.
export { mcpTool } from '@inharness-ai/agent-adapters';
/**
 * 0.2.13 — `createMcpServer` is now the facade's OWN wrapper rather than a bare
 * vendor re-export: it keeps the declared tool list on the handle so the host can
 * render a plugin's operations into REST as well as MCP. See
 * `create-mcp-server.ts` for why a second list was not an option.
 *
 * `CapturedMcpServer` is what it returns — the vendor handle widened with those
 * declarations. In-repo servers annotate their `build*Server()` return with it;
 * it is assignable to the opaque `McpServerFactory` below, which stays the type
 * the host's own contract surface speaks.
 */
export { createMcpServer, type CapturedMcpServer } from './create-mcp-server.js';
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
// 0.2.2 — the C4S-owned server handle. Same name and same meaning as the published
// surface's `McpServerFactory`; the published copy is additionally branded/opaque,
// this one names the single member the host consumes (`config`). In-repo backend
// consumers annotate their `create*ToolsServer()` return with THIS type.
export type { McpServerFactory } from '../../shared/plugin-host/mcp.js';
/**
 * Deprecated alias kept for in-repo consumers written against the 0.1.133 name.
 * @deprecated 0.2.2 — use `McpServerFactory`.
 */
export type { McpServerFactory as McpServerInstance } from '../../shared/plugin-host/mcp.js';
// `McpToolDefinition` is what `mcpTool()` returns — an entity module that splits
// "build the tool list" from "wrap it in a server" (so the tools stay unit-testable)
// needs to name that type without reaching past this facade. Still vendor-typed:
// it is a tool descriptor, not a server handle, and never reaches the host's own
// contract surface (the published surface shows `McpTool = unknown`).
export type { McpToolDefinition } from '@inharness-ai/agent-adapters';
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
// Host API 2.0.0 — the declarative slots an entity contribution must carry.
export type {
  AccessHint,
  CollectionNode,
  DefaultPredicate,
  DataDeclaration,
  EnumNode,
  FieldFlags,
  FieldNode,
  IntegrityConstraint,
  ObjectNode,
  RecordNode,
  ScalarNode,
} from '../../shared/plugin-host/data-schema.js';
export type { SlugPattern, SlugStep } from '../../shared/plugin-host/slug-pattern.js';
/**
 * 0.2.27 — the named-validator registry, for `payloadUpgrades` steps.
 *
 * A migration onto a field that has just gained a validator has to ask whether a
 * stored value passes, and must refuse rather than repair when it does not. The
 * host owns the rule; a plugin transcribing it drifts on the first keyword the
 * host adds.
 */
export { checkValidator, validatorMessage } from '../../shared/plugin-host/named-validators.js';
export type { ValidatorKind, ValidatorFailure } from '../../shared/plugin-host/named-validators.js';
