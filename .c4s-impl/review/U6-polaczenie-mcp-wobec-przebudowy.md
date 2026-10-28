# U6-polaczenie-mcp-wobec-przebudowy — non-blocking review findings

- round 1, rev-0001 (`src/server/mcp/http-mount.ts:106`): an idle open MCP session keeps the last released ProjectContext reachable (disposed, not GC-able) until its next request or the 30-min idle reap — at most one per session, does not grow with rebuild cycles. Pre-existing. Orchestrator: carried into U7 (memory measurement must cover an open idle MCP session; if the flat line fails because of it, fix by dropping the surface on release).
