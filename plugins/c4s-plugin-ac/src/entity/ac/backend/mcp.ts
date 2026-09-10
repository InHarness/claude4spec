// 0.1.133: build the custom MCP server through the C4S facade barrel
// (`@c4s/plugin-runtime`), never the vendor `@inharness-ai/agent-adapters` directly.
// That rule survives the move to an envelope: this package DOES depend on the
// vendor, but only for `createAdapter`/`extractText` in the analysis service —
// the MCP server itself is still built through the facade, whose `mcpTool` and
// `createMcpServer` signatures are part of what `hostApiVersion` covers here.
import { createMcpServer, DomainError, mcpTool, z, type McpServerFactory } from '@c4s/plugin-runtime';
import { AcAnalysisService } from './analysis.service.js';
import type { AcMountContext } from '../../../host-kit/host-types.js';

/**
 * M13: CRUD (create/get/update/delete/list) moved to the generic `entity-tools`
 * server — this custom server carries ONLY ac's non-CRUD tool, the LLM-based
 * semantic audit.
 *
 * 0.2.80 — the mount context, narrowed.
 *
 * Was `reader` + `host` + `discovery` + `cwd` + `roots`: a raw projection
 * reader, the whole read catalogue, and the page roots the service used to
 * resolve its own turn scope with. What the tool actually needs is the four
 * bound read operations, the registry view, the project root, and a scope it
 * asks the host for.
 */
export type AcToolsDeps = AcMountContext;

export function createAcToolsServer(deps: AcToolsDeps): McpServerFactory {
  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  });
  const fail = (err: unknown) => {
    const code = err instanceof DomainError ? err.code : 'INTERNAL';
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: message, code }) }],
      isError: true,
    };
  };

  // The service takes the SAME context, not a re-packed subset — there is
  // nothing left to narrow, and re-listing the fields is how the two drift.
  const analysisService = new AcAnalysisService(deps);

  const analyzeAcAgainstEntities = mcpTool(
    'analyze_ac_against_entities',
    'LLM-based on-demand semantic check: for each active AC, load its `text` + `verifies[]` + the linked entity snapshots and ask the model whether the AC text matches the shape of those entities. Non-deterministic and expensive — call deliberately, not in a loop. Distinct from `check_consistency` (which is deterministic and structural). Output: { issues: [{ ac_slug, issue_type, details, affected_entity?, confidence, suggested_correction? }], analyzed_count, skipped_count, skipped_reasons }.',
    {
      scope_tag: z
        .string()
        .optional()
        .describe('Limit analysis to active ACs carrying this tag slug. Omit for all active ACs.'),
      ac_slug: z
        .string()
        .optional()
        .describe('Limit analysis to a single AC by slug. Omit to analyse all active ACs.'),
    },
    async (raw) => {
      const args = raw as Record<string, unknown>;
      try {
        const result = await analysisService.analyze({
          scope_tag: args.scope_tag as string | undefined,
          ac_slug: args.ac_slug as string | undefined,
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  return createMcpServer({
    name: 'ac-tools',
    tools: [analyzeAcAgainstEntities],
  });
}
