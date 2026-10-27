/**
 * The facade's `createMcpServer` — the vendor builder, plus the one thing the
 * vendor throws away.
 *
 * `@inharness-ai/agent-adapters` returns `{ server, config }`: the `tools` array
 * you passed in is consumed by the SDK server and cannot be read back off the
 * handle. That was invisible while MCP was the only rendering of a tool. It
 * stopped being invisible in 0.2.13, when `GET /api/entities/:type/tools` and
 * `POST /api/entities/:type/tools/:tool` had to expose a type's non-CRUD
 * operations over REST.
 *
 * The alternative — a second, hand-maintained list of each type's tools — is the
 * exact failure this release exists to remove: two sources for one fact, drifting
 * the moment someone edits one of them. (The repo already has two of those for
 * the CRUD server alone: `ENTITY_TOOLS_MCP_LINE` and `buildEntityToolsLine()`.)
 *
 * So the facade keeps the declarations on the handle. `buildMcpServers()` reads
 * `.config` exactly as before; the REST proxy and the profile gate read `.tools`.
 * One registry, three renderings.
 *
 * This wrapper is the ONLY exported builder — in-repo built-ins import it by
 * relative path, external plugins reach it through the `@c4s/plugin-runtime`
 * bare alias, and both resolve to this module. A handle without `.tools` can
 * therefore only be a hand-rolled descriptor or one from a pre-0.2.13 plugin,
 * which is why every consumer treats absence as "nothing to enumerate" rather
 * than as an error.
 */

import {
  createMcpServer as vendorCreateMcpServer,
  type McpServerInstance,
  type McpToolDefinition,
} from '@inharness-ai/agent-adapters';
import type { McpToolDeclaration } from '../../shared/plugin-host/mcp.js';

export interface CreateMcpServerOptions {
  name: string;
  version?: string;
  tools?: McpToolDefinition[];
}

/**
 * The vendor handle WIDENED with the declarations, never narrowed to the
 * host-owned `McpServerFactory`.
 *
 * Two callers need what narrowing would have thrown away: `routes/agent-turn.ts`
 * hands `.config` to the adapter as a typed `McpServerConfig`, and
 * `bin/c4s-mcp.ts` connects `.server` to a stdio transport. The result is still
 * assignable to `McpServerFactory` — that handle names a subset — so the host's
 * contract surface keeps showing only `config` and `tools`, and the vendor stays
 * an implementation detail of this module.
 */
export type CapturedMcpServer = McpServerInstance & { readonly tools: readonly McpToolDeclaration[] };

/**
 * 2.1.57 (M13 `z7l89jhf`, M33 `m33load01` (d)) — the machine code of a tool
 * server the pool refuses: a tool name declared twice in one server, or a server
 * name already registered in the pool. Modelled on `PLUGIN_TYPE_CONFLICT`.
 */
export const PLUGIN_TOOL_CONFLICT = 'PLUGIN_TOOL_CONFLICT';

/**
 * A tool server the pool refuses at plugin load (`PLUGIN_TOOL_CONFLICT`).
 *
 * Recognised by its `code`, not by `instanceof`: a plugin resolves this module
 * through the `@c4s/plugin-runtime` bare alias, and the host must not depend on
 * that resolution yielding the very same class object.
 */
export class PluginToolConflictError extends Error {
  readonly code = PLUGIN_TOOL_CONFLICT;
  constructor(
    message: string,
    /** The server the conflict is attributed to. */
    public readonly serverName: string,
  ) {
    super(`${PLUGIN_TOOL_CONFLICT}: ${message}`);
    this.name = 'PluginToolConflictError';
  }
}

export function isPluginToolConflict(err: unknown): err is PluginToolConflictError {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === PLUGIN_TOOL_CONFLICT;
}

export function createMcpServer(options: CreateMcpServerOptions): CapturedMcpServer {
  // 2.1.57 — a duplicate tool name is refused HERE, with its code, before the
  // vendor sees it. The vendor's own refusal (the MCP SDK's "already
  // registered") is an anonymous error that the pool used to swallow by
  // dropping the whole server for the turn; this one the host recognises at
  // plugin load (`ProjectPluginHostImpl.mountBackend`).
  const seen = new Set<string>();
  for (const t of options.tools ?? []) {
    if (seen.has(t.name)) {
      throw new PluginToolConflictError(
        `tool "${t.name}" is declared twice in MCP server "${options.name}" — tool names must be unique within one server`,
        options.name,
      );
    }
    seen.add(t.name);
  }
  const instance = vendorCreateMcpServer(options);
  // Copied, not aliased: a caller that mutates the array it passed in must not
  // be able to change what the host later reports as this server's surface.
  const tools: readonly McpToolDeclaration[] = Object.freeze(
    (options.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      handler: t.handler,
      ...(t.annotations ? { annotations: t.annotations } : {}),
    })),
  );
  return Object.assign(instance, { tools });
}
