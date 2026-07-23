import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildDiagramTools } from './mcp-server.js';

/**
 * The 0.1.140 `validate_diagram` contract. Two boundaries are tested separately
 * because they behave differently:
 *   - the input SCHEMA, which the MCP SDK parses arguments through before the
 *     handler runs (this is where `format` defaults and where a bad format is
 *     rejected — such a call never reaches the validator);
 *   - the HANDLER, which always answers `{ ok, warnings }` and never throws.
 */
function validateDiagramTool() {
  const tool = buildDiagramTools().find((t) => t.name === 'validate_diagram');
  if (!tool) throw new Error('validate_diagram tool not registered');
  return tool;
}

/** What the MCP SDK does to `params.arguments` before invoking the handler. */
function parseArgs(args: unknown) {
  return z.object(validateDiagramTool().inputSchema as z.ZodRawShape).safeParse(args);
}

async function callTool(args: Record<string, unknown>) {
  const parsed = parseArgs(args);
  if (!parsed.success) throw new Error('arguments rejected by the tool schema');
  const result = await validateDiagramTool().handler(parsed.data as Record<string, unknown>);
  return JSON.parse((result.content[0] as { text: string }).text) as {
    ok: boolean;
    warnings: string[];
  };
}

describe('validate_diagram — input schema', () => {
  it("defaults an omitted format to 'mermaid'", () => {
    const parsed = parseArgs({ source: 'flowchart TD\n  A-->B' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.format).toBe('mermaid');
  });

  it('requires source', () => {
    expect(parseArgs({}).success).toBe(false);
  });

  it('rejects a format outside the enum at the boundary, before the validator', () => {
    expect(parseArgs({ source: 'digraph {}', format: 'graphviz' }).success).toBe(false);
  });
});

describe('validate_diagram — handler', () => {
  it('answers exactly { ok, warnings } — no message, no line', async () => {
    const payload = await callTool({ source: 'not a diagram at all' });
    expect(Object.keys(payload).sort()).toEqual(['ok', 'warnings']);
  });

  it('a well-formed source is ok with an empty warnings list', async () => {
    expect(await callTool({ source: 'flowchart TD\n  A-->B' })).toEqual({ ok: true, warnings: [] });
  });

  it('an unparseable source is not ok and carries one generic warning', async () => {
    const payload = await callTool({ source: 'not a diagram at all' });
    expect(payload.ok).toBe(false);
    expect(payload.warnings).toHaveLength(1);
    expect(payload.warnings[0]).toMatch(/^mermaid source may be invalid: /);
  });

  it('derives ok from warnings — the two can never disagree', async () => {
    for (const source of ['flowchart TD\n  A-->B', 'not a diagram at all', '']) {
      const payload = await callTool({ source });
      expect(payload.ok).toBe(payload.warnings.length === 0);
    }
  });

  it("d2 passes the enum but is not validated — a clean 'not yet validated' answer", async () => {
    expect(await callTool({ source: 'x -> y: hi', format: 'd2' })).toEqual({
      ok: true,
      warnings: [],
    });
  });

  it('an omitted format is validated as mermaid', async () => {
    // Same source, once with the default filled in and once explicit — identical.
    const implicit = await callTool({ source: 'not a diagram at all' });
    const explicit = await callTool({ source: 'not a diagram at all', format: 'mermaid' });
    expect(implicit).toEqual(explicit);
    expect(implicit.ok).toBe(false);
  });
});
