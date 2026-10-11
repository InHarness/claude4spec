plan-tools-get-plan → src/server/mcp/plan-tools.ts (get_plan)
plan-tools-create-plan → src/server/mcp/plan-tools.ts (create_plan)
katalog-operacji-m10#get_plan → src/server/operations/core-operations.ts (get_plan) + src/server/mcp/plan-tools.ts
katalog-operacji-m10#update_plan → src/server/operations/core-operations.ts (update_plan) + src/server/mcp/plan-tools.ts + src/server/routes/artifacts.ts (plan adapter, PUT /api/artifacts/plan/<path>/content)
katalog-operacji-m10#list_plan_versions → src/server/operations/core-operations.ts (list_plan_versions) + src/server/mcp/plan-tools.ts + src/server/routes/artifacts.ts (plan adapter, GET /api/artifacts/plan/<path>/versions)
katalog-operacji-m10#get_plan_version → src/server/operations/core-operations.ts (get_plan_version) + src/server/mcp/plan-tools.ts + src/server/routes/artifacts.ts (plan adapter, GET /api/artifacts/plan/<path>/versions/:version)
katalog-operacji-m10#mark_plan_applied → src/server/operations/core-operations.ts (mark_plan_applied) + src/server/mcp/plan-tools.ts + src/server/routes/artifacts.ts (plan adapter, PATCH /api/artifacts/plan/<path>/frontmatter)
katalog-operacji-m10#create_plan → src/server/operations/core-operations.ts (create_plan) + src/server/mcp/plan-tools.ts
katalog-operacji-m10#execute_plan → src/server/operations/core-operations.ts (execute_plan) + src/server/routes/plans.ts (POST /api/plans/:planId/create-thread)
brief-tools-get-brief → src/server/mcp/brief-tools.ts (get_brief) + src/server/services/brief.ts (getBrief: range window + budget, BRIEF_NOT_FOUND)
katalog-operacji-m21#get_brief → src/server/operations/core-operations.ts (get_brief) + src/server/mcp/brief-tools.ts + src/server/routes/artifacts.ts (brief adapter, GET /api/artifacts/brief/<path>) + src/bin/c4s/commands/get-brief.ts
katalog-operacji-m21#list_briefs → src/server/operations/core-operations.ts (list_briefs) + src/server/routes/artifacts.ts (brief adapter list, ?implemented/?limit/?offset) + src/bin/c4s/commands/list-briefs.ts
katalog-operacji-m21#update_brief → src/server/operations/core-operations.ts (update_brief) + src/server/mcp/brief-tools.ts + src/server/routes/artifacts.ts (PUT /api/artifacts/brief/<path>/content)
katalog-operacji-m21#mark_brief_implemented → src/server/operations/core-operations.ts (mark_brief_implemented) + src/server/services/brief.ts (updateFrontmatter) + src/server/routes/artifacts.ts (PATCH /api/artifacts/brief/<path>/frontmatter) + src/bin/c4s/commands/mark-brief-implemented.ts
katalog-operacji-m21#list_brief_versions → src/server/operations/core-operations.ts (list_brief_versions) + src/server/services/brief.ts (listVersionsAddressed) + src/server/mcp/brief-tools.ts + src/server/routes/artifacts.ts (brief adapter, GET .../versions)
katalog-operacji-m21#get_brief_version → src/server/operations/core-operations.ts (get_brief_version) + src/server/services/brief.ts (getVersionAddressed) + src/server/mcp/brief-tools.ts + src/server/routes/artifacts.ts (brief adapter, GET .../versions/:version)
katalog-operacji-m21#create_brief → src/server/operations/core-operations.ts (create_brief) + src/server/services/brief.ts (createBrief, requireWindowRelease) + src/server/routes/briefs.ts (POST /api/briefs) + src/bin/c4s/commands/create-brief.ts
