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

export interface McpServerFactory {
  /**
   * The adapter-facing server config. Deliberately `unknown`: the host only ever
   * forwards it, never inspects its shape — `buildMcpServers()` validates that it is
   * merely present (a hand-rolled `{name, version, tools}` descriptor has no `config`
   * and is rejected there).
   */
  readonly config: unknown;
}
