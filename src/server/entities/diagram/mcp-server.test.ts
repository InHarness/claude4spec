import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDiagramTools, createDiagramToolsServer } from './mcp-server.js';

/**
 * The 0.1.140 `validate_diagram` contract, exercised through a REAL MCP client
 * over an in-memory transport rather than by re-implementing the SDK's argument
 * handling. That matters for two of the assertions below: whether an omitted
 * `format` is defaulted, and what a caller actually sees when `format` is
 * outside the enum, are both decided by the SDK's own schema layer — asserting
 * them against a hand-rolled `z.object(shape)` would only test our model of it.
 */
let client: Client;

beforeAll(async () => {
  const { server } = createDiagramToolsServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'diagram-tools-test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
});

/** Calls the tool and unwraps the JSON payload the handler encodes as text. */
async function callTool(args: Record<string, unknown>) {
  const result = (await client.callTool({ name: 'validate_diagram', arguments: args })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  return {
    isError: Boolean(result.isError),
    text: result.content[0]?.text ?? '',
    payload: result.isError
      ? null
      : (JSON.parse(result.content[0].text) as { ok: boolean; warnings: string[] }),
  };
}

describe('validate_diagram — advertised schema', () => {
  it('is registered with source required and format optional-with-a-default', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'validate_diagram');
    expect(tool).toBeDefined();

    const schema = tool!.inputSchema as {
      required?: string[];
      properties: Record<string, { default?: unknown; enum?: unknown[] }>;
    };
    expect(schema.required).toEqual(['source']);
    expect(schema.properties.format.default).toBe('mermaid');
    expect(schema.properties.format.enum).toEqual(['mermaid', 'd2']);
  });
});

describe('validate_diagram — results', () => {
  it('answers exactly { ok, warnings } — no message, no line', async () => {
    const { payload } = await callTool({ source: 'not a diagram at all' });
    expect(Object.keys(payload!).sort()).toEqual(['ok', 'warnings']);
  });

  it('a well-formed source is ok with an empty warnings list', async () => {
    const { payload } = await callTool({ source: 'flowchart TD\n  A-->B' });
    expect(payload).toEqual({ ok: true, warnings: [] });
  });

  it('an unparseable source is not ok and carries one generic warning', async () => {
    const { payload } = await callTool({ source: 'not a diagram at all' });
    expect(payload!.ok).toBe(false);
    expect(payload!.warnings).toHaveLength(1);
    expect(payload!.warnings[0]).toMatch(/^mermaid source may be invalid: /);
  });

  it('derives ok from warnings — the two can never disagree', async () => {
    for (const source of ['flowchart TD\n  A-->B', 'not a diagram at all', '']) {
      const { payload } = await callTool({ source });
      expect(payload!.ok).toBe(payload!.warnings.length === 0);
    }
  });

  it("d2 passes the enum but is not validated — a clean 'not yet validated' answer", async () => {
    const { payload } = await callTool({ source: 'x -> y: hi', format: 'd2' });
    expect(payload).toEqual({ ok: true, warnings: [] });
  });

  it('an omitted format is defaulted to mermaid and validated as such', async () => {
    const implicit = await callTool({ source: 'not a diagram at all' });
    const explicit = await callTool({ source: 'not a diagram at all', format: 'mermaid' });
    expect(implicit.payload).toEqual(explicit.payload);
    expect(implicit.payload!.ok).toBe(false);
  });

  it('rejects a format outside the enum at the schema boundary', async () => {
    // The caller sees an error envelope, not a warning — this never reaches the
    // validator, so it is NOT the "never blocks" path. `d2` above is.
    const { isError, text } = await callTool({ source: 'digraph {}', format: 'graphviz' });
    expect(isError).toBe(true);
    expect(text).toMatch(/validation/i);
  });

  it('never throws when the handler is called directly, without SDK parsing', async () => {
    // `buildDiagramTools` is exported for testability, so the handler is reachable
    // with unparsed arguments. A linter must answer, not blow up.
    const tool = buildDiagramTools().find((t) => t.name === 'validate_diagram')!;
    for (const args of [{}, { format: 'mermaid' }, { source: null }, { source: 42 }]) {
      const result = await tool.handler(args as Record<string, unknown>);
      const payload = JSON.parse((result.content[0] as { text: string }).text);
      expect(payload).toEqual({ ok: true, warnings: [] });
    }
  });
});
