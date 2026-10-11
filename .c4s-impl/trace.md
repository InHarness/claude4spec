plan-tools-get-plan → src/server/mcp/plan-tools.ts (get_plan)
plan-tools-create-plan → src/server/mcp/plan-tools.ts (create_plan)
katalog-operacji-m10#get_plan → src/server/operations/core-operations.ts (get_plan) + src/server/mcp/plan-tools.ts
katalog-operacji-m10#update_plan → src/server/operations/core-operations.ts (update_plan) + src/server/mcp/plan-tools.ts + src/server/routes/artifacts.ts (plan adapter, PUT /api/artifacts/plan/<path>/content)
katalog-operacji-m10#list_plan_versions → src/server/operations/core-operations.ts (list_plan_versions) + src/server/mcp/plan-tools.ts + src/server/routes/artifacts.ts (plan adapter, GET /api/artifacts/plan/<path>/versions)
katalog-operacji-m10#get_plan_version → src/server/operations/core-operations.ts (get_plan_version) + src/server/mcp/plan-tools.ts + src/server/routes/artifacts.ts (plan adapter, GET /api/artifacts/plan/<path>/versions/:version)
katalog-operacji-m10#mark_plan_applied → src/server/operations/core-operations.ts (mark_plan_applied) + src/server/mcp/plan-tools.ts + src/server/routes/artifacts.ts (plan adapter, PATCH /api/artifacts/plan/<path>/frontmatter)
katalog-operacji-m10#create_plan → src/server/operations/core-operations.ts (create_plan) + src/server/mcp/plan-tools.ts
katalog-operacji-m10#execute_plan → src/server/operations/core-operations.ts (execute_plan) + src/server/routes/plans.ts (POST /api/plans/:planId/create-thread)
