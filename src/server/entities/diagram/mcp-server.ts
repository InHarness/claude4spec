// 0.1.133: build the custom MCP server through the C4S facade barrel
// (`@c4s/plugin-runtime`), never the vendor `@inharness-ai/agent-adapters` directly.
import {
  createMcpServer,
  mcpTool,
  type McpServerInstance,
  type McpToolDefinition,
} from '../../plugin-runtime/index.js';
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

/**
 * The tool list, separate from the server wrapper below — mirrors
 * `buildEntityTools()` so each tool's `inputSchema` and `handler` stay reachable
 * from a unit test without standing up an MCP transport.
 */
export function buildDiagramTools(_deps: DiagramToolsDeps = {}): McpToolDefinition[] {
  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  });

  const validateDiagram = mcpTool(
    'validate_diagram',
    'Pre-flight validation of a diagram DSL source (mermaid.parse()) BEFORE creating/updating an entity. ' +
      'Never blocks — returns warnings only. Use to check a source is well-formed before writing it.',
    {
      source: z.string().describe('DSL body to validate.'),
      // `.default()` (not `.optional()`): the MCP SDK parses arguments through this
      // shape before the handler runs, so an omitted `format` arrives as 'mermaid'
      // and the advertised JSON Schema carries the default. A format outside the
      // enum is rejected at that boundary and never reaches the validator.
      format: formatSchema.default('mermaid').describe("Diagram language (default 'mermaid')."),
    },
    async (args) => {
      // Coerced rather than cast: the schema above guarantees these when the SDK
      // parses arguments for us, but `buildDiagramTools` is exported, so a caller
      // holding this handler directly can hand it anything. A tool whose contract
      // is "never blocks, warnings only" must not answer with a TypeError.
      const format = typeof args.format === 'string' ? args.format : 'mermaid';
      const source = typeof args.source === 'string' ? args.source : '';
      // `warnings` is the SAME array the CRUD path returns — `ok` is purely derived.
      // No `message`/`line`: a flat list, and "unsupported format" is a client-render
      // concern, never a validator complaint.
      const warnings = await validateDiagramSource(format, source);
      return ok({ ok: warnings.length === 0, warnings });
    },
  );

  return [validateDiagram];
}

export function createDiagramToolsServer(deps: DiagramToolsDeps = {}): McpServerInstance {
  return createMcpServer({
    name: 'diagram-tools',
    tools: buildDiagramTools(deps),
  });
}
