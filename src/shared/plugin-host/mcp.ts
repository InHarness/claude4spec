/**
 * 0.2.2 (decyzja B′) — the host-owned MCP server facade.
 *
 * `backend.mcpServer` and `MountContext.registerMcpServer` used to be typed with
 * `McpServerInstance` imported straight from `@inharness-ai/agent-adapters`, which
 * made the vendor part of the host's own contract: a vendor bump would have been a
 * `hostApiVersion` bump. It is now an INTERNAL IMPLEMENTATION DETAIL hidden behind
 * this handle — not an externalized peer like React, Tiptap, TanStack or lucide-react.
 *
 * The handle names exactly the one member the host actually consumes: `config`, which
 * `runAgentTurn` reads into the adapter's `mcpServers` map. Everything else about the
 * vendor instance stays opaque here, which is what lets the published surface
 * (`plugin-types/plugin-runtime.ts`) show a fully branded, member-less
 * `McpServerFactory` without the two views drifting apart in meaning.
 *
 * The single remaining place that re-widens this to the concrete vendor type is the
 * adapter boundary in `server/routes/agent-turn.ts`, which imports the vendor anyway
 * because it is the code handing the config to the adapter.
 */

/**
 * 0.2.13 — one tool as DECLARED, kept alongside the built server.
 *
 * The vendor's server handle is `{ server, config }`: the tool list handed to
 * `createMcpServer(...)` is consumed and not recoverable from the result. That
 * was fine while MCP was the only rendering, and stopped being fine when
 * `GET /api/entities/:type/tools` had to answer "what can this type do" over
 * REST. Answering it from a second, hand-maintained list is precisely the drift
 * the operation catalog exists to remove — so the facade CAPTURES the
 * declarations instead, and both renderings read this one array.
 *
 * Host-owned and structural rather than re-exported from the vendor, for the
 * same reason `config` is `unknown` here: the vendor stays an implementation
 * detail of the facade, not part of the host's contract surface.
 */
export interface McpToolDeclaration {
  readonly name: string;
  /** LLM-facing. Rendered verbatim by every channel that needs a description. */
  readonly description: string;
  /** Zod RAW SHAPE, as handed to `mcpTool(name, description, shape, handler)`. */
  readonly inputSchema: Record<string, unknown>;
  /**
   * Deliberately loose in its return type: the REST proxy forwards whatever the
   * handler produced without inspecting it, so the two renderings cannot answer
   * differently. Narrowing it here would only invite a transport to reshape it.
   */
  readonly handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
}

export interface McpServerFactory {
  /**
   * The adapter-facing server config. Deliberately `unknown`: the host only ever
   * forwards it, never inspects its shape — `buildMcpServers()` validates that it is
   * merely present (a hand-rolled `{name, version, tools}` descriptor has no `config`
   * and is rejected there).
   */
  readonly config: unknown;
  /**
   * The tools this server was built from. Present on every handle the
   * `@c4s/plugin-runtime` facade produced — which is every handle in the repo and
   * every handle an external plugin can legally produce, since the facade is the
   * only exported builder. Optional so a hand-rolled or pre-0.2.13 handle still
   * type-checks; consumers treat "absent" as "this server declares nothing I can
   * enumerate", never as an error.
   */
  readonly tools?: readonly McpToolDeclaration[];
}
