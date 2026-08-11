import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression for AMBIGUOUS_WORKSPACE (brief 0-1-86-to-next): `mcp__c4s-tools__ask`
 * must default to the caller's workspace so a project registered in N>1 workspaces
 * does not trip the 0/1/N rule in `resolveWorkspaceProject`. An explicit
 * `input.workspace` still wins.
 *
 * We stub `runAgent` (the real layer that would throw AMBIGUOUS_WORKSPACE) and
 * capture the params it receives, then drive the real `ask` tool handler through
 * the live MCP server over an in-memory transport.
 */
const hoisted = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../core/agent/run-agent.js', () => ({
  runAgent: vi.fn(async (params: Record<string, unknown>) => {
    hoisted.calls.push(params);
    return { threadId: 'peer-thread', answer: 'pong' };
  }),
  AgentError: class AgentError extends Error {
    code: string;
    hint?: string;
    constructor(code: string, message: string, hint?: string) {
      super(message);
      this.code = code;
      this.hint = hint;
    }
  },
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildC4sToolsServer } from './c4s-tools.js';

async function connectClient(callerWorkspace?: string): Promise<Client> {
  const { server } = buildC4sToolsServer(callerWorkspace);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

describe('buildC4sToolsServer — ask workspace inheritance', () => {
  beforeEach(() => {
    hoisted.calls.length = 0;
  });

  it('(a) inherits callerWorkspace when input.workspace is absent', async () => {
    const client = await connectClient('ws-5555');
    const res = await client.callTool({ name: 'ask', arguments: { message: 'ping' } });

    expect(res.isError).toBeFalsy();
    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]).toMatchObject({ workspace: 'ws-5555' });
  });

  it('(b) explicit input.workspace overrides callerWorkspace', async () => {
    const client = await connectClient('ws-5555');
    await client.callTool({ name: 'ask', arguments: { message: 'ping', workspace: 'ws-5556' } });

    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]).toMatchObject({ workspace: 'ws-5556' });
  });

  it('degrades to undefined when neither caller nor input supplies a workspace', async () => {
    const client = await connectClient();
    await client.callTool({ name: 'ask', arguments: { message: 'ping' } });

    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]?.workspace).toBeUndefined();
  });

  it('forwards the optional effort param to runAgent', async () => {
    const client = await connectClient('ws-5555');
    await client.callTool({ name: 'ask', arguments: { message: 'ping', effort: 'low' } });

    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]).toMatchObject({ effort: 'low' });
  });

  it('leaves effort undefined when not supplied (default resolves in runAgent)', async () => {
    const client = await connectClient('ws-5555');
    await client.callTool({ name: 'ask', arguments: { message: 'ping' } });

    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]?.effort).toBeUndefined();
  });

  it('forwards a valid model + effort to runAgent', async () => {
    const client = await connectClient('ws-5555');
    await client.callTool({
      name: 'ask',
      arguments: { message: 'ping', model: 'opus-5', effort: 'high' },
    });

    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]).toMatchObject({ model: 'opus-5', effort: 'high' });
  });

  /**
   * The inverse of the `effort` case below, and deliberately so: `model` is a
   * pass-through string, `effort` is an enum.
   *
   * `model` used to be `z.enum(ALLOWED_MODELS)`, which refused an unknown alias
   * here — at the MCP schema boundary, as an input-validation error. The
   * declared contract is that the value reaches the peer and comes back as
   * `AGENT_ERROR`: the runtime is the only side that knows what it can run, and
   * it refuses in its own vocabulary. So "unknown model" is not this layer's
   * question to answer, and the forwarding is what this test locks.
   */
  it('forwards an unknown model to the peer rather than refusing it at the schema boundary', async () => {
    const client = await connectClient('ws-5555');
    await client.callTool({
      name: 'ask',
      arguments: { message: 'ping', model: 'gpt-4' },
    });

    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]).toMatchObject({ model: 'gpt-4' });
  });

  it('rejects an out-of-range effort (e.g. max) at the MCP schema boundary', async () => {
    const client = await connectClient('ws-5555');
    const res = await client.callTool({
      name: 'ask',
      arguments: { message: 'ping', effort: 'max' },
    });

    expect(res.isError).toBeTruthy();
    expect(hoisted.calls).toHaveLength(0);
  });
});
