import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import { validateDiagramSource } from './validate.js';

/**
 * M13: CRUD (create/get/update/delete/list) moved to the generic `entity-tools`
 * server — this custom server carries ONLY diagram's non-CRUD pre-flight
 * validation tool. No service dependency: `validate_diagram` checks a raw
 * source string with no DB lookup (an entity need not exist yet).
 */
export type DiagramToolsDeps = Record<string, never>;

const formatSchema = z.enum(['mermaid', 'd2']);

export function createDiagramToolsServer(_deps: DiagramToolsDeps = {}): McpServerInstance {
  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  });

  const validateDiagram = mcpTool(
    'validate_diagram',
    'Pre-flight validation of a diagram DSL source (mermaid.parse()) BEFORE creating/updating an entity. ' +
      'Never blocks — returns warnings only. Use to check a source is well-formed before writing it.',
    {
      source: z.string().describe('DSL body to validate.'),
      format: formatSchema.optional().describe("Diagram language (default 'mermaid')."),
    },
    async (args) => {
      const format = (args.format as string | undefined) ?? 'mermaid';
      const warnings = await validateDiagramSource(format, String(args.source ?? ''));
      return ok({ ok: warnings.length === 0, warnings });
    },
  );

  return createMcpServer({
    name: 'diagram-tools',
    tools: [validateDiagram],
  });
}
