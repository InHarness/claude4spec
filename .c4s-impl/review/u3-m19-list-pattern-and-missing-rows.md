# u3 — non-blocking
- rev-0001 `src/client/xml-markup/tags/references/ElementList.tsx:51` — header count `labelPlural · slugs.length` still counts deleted slugs (e.g. "Endpoints · 3" over 2 rows; all deleted → count over an empty <ul>, no empty placeholder).
- rev-0002 `plugins/c4s-plugin-mcp-tools/src/entity/mcp-tool/frontend/routes.tsx:225` — shared empty state reads "No MCP tools described yet." also for an empty filter result; a neutral title (as database-tables) would fit both.
- dev-0001 (sent) — TagFilterBar stacked under the header instead of the `filters` slot.
