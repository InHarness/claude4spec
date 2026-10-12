# Trace

git-status-response → src/shared/git.ts (GitRepoInfo / GitStatusResponse; served by GET /api/git/status in src/server/routes/git.ts)
page-tools-update-page → src/server/mcp/page-tools.ts (update_page on page-tools; core: updatePage in src/server/services/page-write.ts)
put-api-pages → src/server/routes/pages.ts (router.put('/*') — update_page literal mode)
katalog-operacji-m02#update_page → src/server/operations/core-operations.ts (CATALOG.register(pageWrite('update_page', …)))
c4s-reader-get-page → src/server/mcp/c4s-reader.ts (get_page on c4s-reader — loose input object, forwards `range` to the core; core: getPage in src/server/discovery/ops/pages.ts)
reference-tools-get-page → src/server/mcp/reference-tools.ts (get_page on reference-tools — loose input object, forwards `range` to the core; core: getPage in src/server/discovery/ops/pages.ts)
wpis-serwera-c4s-reader → src/server/mcp/mcp-config.ts (renderMcpConfigVariants — three `mcpServers.c4s-reader` entries; stdio `npx -y -p @inharness-ai/claude4spec c4s-mcp --url …`; served by src/server/routes/mcp-config.ts)
mcp-config-response → src/shared/mcp-config.ts (McpConfigResponse / McpConfigVariant; served by GET /api/projects/:id/_meta/mcp-config in src/server/routes/mcp-config.ts)
