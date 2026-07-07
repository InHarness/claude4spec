import {
  createMcpServer,
  mcpTool,
  type McpServerInstance,
} from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import type { AcService } from './service.js';
import { AcAnalysisService } from './ac-analysis.service.js';
import type { PluginHost } from '../../core/plugin-host/types.js';
import { DomainError } from '../../services/tags.js';

/**
 * M13: CRUD (create/get/update/delete/list) moved to the generic `entity-tools`
 * server — this custom server carries ONLY ac's non-CRUD tool, the LLM-based
 * semantic audit.
 */
export interface AcToolsDeps {
  acService: AcService;
  /** M19→AC: needed to hydrate verified-entity snapshots for the LLM audit. */
  db: Database;
  /** M19→AC: project root for the LLM adapter. */
  cwd: string;
  /** Brief 0.1.45 §1: inactive guard for the semantic audit. */
  host: PluginHost;
}

export function createAcToolsServer(deps: AcToolsDeps): McpServerInstance {
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

  const analysisService = new AcAnalysisService({
    acService: deps.acService,
    db: deps.db,
    cwd: deps.cwd,
    host: deps.host,
  });

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
    async (args) => {
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
