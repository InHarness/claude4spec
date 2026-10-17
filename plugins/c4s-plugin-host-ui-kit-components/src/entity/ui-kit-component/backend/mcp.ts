// Built through the C4S facade (`@c4s/plugin-runtime`), never the vendor
// `@inharness-ai/agent-adapters` directly (M33 `m33l11sc`, decision B′).
import { createMcpServer, DomainError, mcpTool, z, type McpServerFactory } from '@c4s/plugin-runtime';
import type { ReadOps } from '../../../host-kit/host-types.js';
import { UI_KIT_AUDIT_TOOL, UI_KIT_TOOLS_SERVER } from '../../../identity.js';
import { AUDIT_RULES, auditUiKitComponents } from './audit.js';
import { readAllRecords } from './read-records.js';

/**
 * The `ui-kit-component-tools` server (c4s-plugin-host-ui-kit-components
 * `vc51375k`, `6o1rfh21`): one tool, `audit_ui_kit_components`. CRUD is the
 * host's generic `entity-tools`; the REST channel reaches this tool through
 * the host's generic proxy `POST /api/entities/ui-kit-component/tools/audit_ui_kit_components`.
 *
 * The audit is realised by the server itself — the type declares no
 * `backend.service` (the page leaves that open; ASSUMPTION:dev-2802).
 */
export function createUiKitComponentToolsServer(ops: ReadOps): McpServerFactory {
  const ok = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload) }] });
  const fail = (err: unknown) => {
    const code = err instanceof DomainError ? err.code : 'INTERNAL';
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message, code }) }], isError: true };
  };

  const audit = mcpTool(
    UI_KIT_AUDIT_TOOL,
    'Check ui-kit-component records against the cross-field and cross-record rules the schema cannot express: ' +
      `${AUDIT_RULES.join(', ')}. Read-only and idempotent — it reports violations and fixes nothing. ` +
      'Output: { checked, violations: [{ rule, slugs, message }] }; an empty list means compliance. ' +
      'Refuses the whole call when `slugs` names a slug without a record or `rules` names an unknown rule.',
    {
      slugs: z
        .array(z.string())
        .optional()
        .describe('Limit the checked records to these slugs. Cross-record rules still compare them with every record. Omit for all records.'),
      rules: z
        .array(z.string())
        .optional()
        .describe(`Limit the checked rules. Omit for all four: ${AUDIT_RULES.join(', ')}.`),
    },
    async (raw) => {
      const args = raw as { slugs?: string[]; rules?: string[] };
      try {
        return ok(auditUiKitComponents(readAllRecords(ops), { slugs: args.slugs, rules: args.rules }));
      } catch (err) {
        return fail(err);
      }
    },
    { readOnlyHint: true, idempotentHint: true },
  );

  return createMcpServer({ name: UI_KIT_TOOLS_SERVER, tools: [audit] });
}
