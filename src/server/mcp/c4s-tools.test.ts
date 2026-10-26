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
  /** The peer's answer the next `runAgent` returns; `'pong'` when unset. */
  nextAnswer: undefined as string | undefined,
}));

vi.mock('../../core/agent/run-agent.js', () => ({
  runAgent: vi.fn(async (params: Record<string, unknown>) => {
    hoisted.calls.push(params);
    const answer = hoisted.nextAnswer ?? 'pong';
    hoisted.nextAnswer = undefined;
    return { threadId: 'peer-thread', answer };
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
import { ASK_TOOL_DESCRIPTION, buildC4sToolsServer } from './c4s-tools.js';
import { AgentError, runAgent } from '../../core/agent/run-agent.js';
import { toolAdmittedByProfile } from '../operations/profile-gate.js';
import { CONTEXT_TYPE_REGISTRY } from '../services/chat-context.js';
import { INTERACTION_RULES } from '../services/interaction-rules.js';

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
    const res = await client.callTool({ name: 'ask', arguments: { message: 'ping', project: 'peer' } });

    expect(res.isError).toBeFalsy();
    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]).toMatchObject({ workspace: 'ws-5555' });
  });

  it('[section:m11dcore] 2.1.53 — the addressing sentence: `workspace` reaches another workspace, omitted = this server\'s', async () => {
    const client = await connectClient('ws-5555');
    const { tools } = await client.listTools();
    const ask = tools.find((t) => t.name === 'ask')!;
    expect(ask.description).toContain(
      "Address the peer with `project` — its `id` exactly as `<workspace_projects/>` lists it. Pass `workspace` only to reach a peer in another workspace; without it `project` is resolved in this server's workspace.",
    );
    expect(ask.description).not.toContain('belongs to more than one workspace');
    await client.callTool({ name: 'ask', arguments: { message: 'ping', project: 'peer' } });
    expect(hoisted.calls[0]).toMatchObject({ workspace: 'ws-5555', channel: 'mcp' });
  });

  it('(b) explicit input.workspace overrides callerWorkspace', async () => {
    const client = await connectClient('ws-5555');
    await client.callTool({ name: 'ask', arguments: { message: 'ping', project: 'peer', workspace: 'ws-5556' } });

    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]).toMatchObject({ workspace: 'ws-5556' });
  });

  it('degrades to undefined when neither caller nor input supplies a workspace', async () => {
    const client = await connectClient();
    await client.callTool({ name: 'ask', arguments: { message: 'ping', project: 'peer' } });

    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]?.workspace).toBeUndefined();
  });

  it('forwards the optional effort param to runAgent', async () => {
    const client = await connectClient('ws-5555');
    await client.callTool({ name: 'ask', arguments: { message: 'ping', project: 'peer', effort: 'low' } });

    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]).toMatchObject({ effort: 'low' });
  });

  it('leaves effort undefined when not supplied (default resolves in runAgent)', async () => {
    const client = await connectClient('ws-5555');
    await client.callTool({ name: 'ask', arguments: { message: 'ping', project: 'peer' } });

    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]?.effort).toBeUndefined();
  });

  it('forwards a valid model + effort to runAgent', async () => {
    const client = await connectClient('ws-5555');
    await client.callTool({
      name: 'ask',
      arguments: { message: 'ping', project: 'peer', model: 'opus-5.5', effort: 'high' },
    });

    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]).toMatchObject({ model: 'opus-5.5', effort: 'high' });
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
      arguments: { message: 'ping', project: 'peer', model: 'gpt-4' },
    });

    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]).toMatchObject({ model: 'gpt-4' });
  });

  it('rejects an out-of-range effort (e.g. max) at the MCP schema boundary', async () => {
    const client = await connectClient('ws-5555');
    const res = await client.callTool({
      name: 'ask',
      arguments: { message: 'ping', project: 'peer', effort: 'max' },
    });

    expect(res.isError).toBeTruthy();
    expect(hoisted.calls).toHaveLength(0);
  });
});

describe('buildC4sToolsServer — ask addressing (2.1.0)', () => {
  beforeEach(() => {
    hoisted.calls.length = 0;
  });

  it('forwards `project` (the id) and `server` to runAgent', async () => {
    const client = await connectClient('ws-5555');
    const res = await client.callTool({
      name: 'ask',
      arguments: { message: 'ping', project: 'app-spec', server: 'https://c4s.firma.dev' },
    });
    expect(res.isError).toBeFalsy();
    expect(hoisted.calls[0]).toMatchObject({ project: 'app-spec', server: 'https://c4s.firma.dev', contextType: 'ask' });
  });

  it('[ac:ac-wywolanie-narzedzia-mcp-ask-bez-proje] refuses LOCALLY, before any peer call: missing project, empty project, empty message', async () => {
    const client = await connectClient('ws-5555');
    for (const args of [{ message: 'ping' }, { message: 'ping', project: '  ' }, { message: '', project: 'app-spec' }]) {
      const res = await client.callTool({ name: 'ask', arguments: args });
      expect(res.isError, JSON.stringify(args)).toBeTruthy();
    }
    expect(hoisted.calls).toHaveLength(0);
  });

  it('declares `project` required and has no projectSlug/projectPath/contextType/brief/plan input', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const schema = tools.find((t) => t.name === 'ask')!.inputSchema as {
      required?: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toEqual(expect.arrayContaining(['message', 'project']));
    // 2.1.29: plan attach (`planPath`) is a CLI-only surface of `runAgent`.
    for (const gone of ['projectSlug', 'projectPath', 'contextType', 'brief', 'plan', 'planPath']) {
      expect(schema.properties).not.toHaveProperty(gone);
    }
  });
});

describe('buildC4sToolsServer — ask description (0.2.97)', () => {
  /**
   * The `project` argument is only constructible from the peer list, and that
   * list lives in the system prompt, not in any tool — so the tool names the
   * block that carries it. (The block renders only where there are peers; with
   * none, there is nobody to consult.)
   */
  it('points at <workspace_projects/> for the peers it can consult', async () => {
    const client = await connectClient('ws-5555');
    const { tools } = await client.listTools();
    const ask = tools.find((t) => t.name === 'ask');
    expect(ask?.description).toContain('exactly as `<workspace_projects/>` lists it');
  });
});

describe('c4s-tools · ask — contract (2.1.9)', () => {
  beforeEach(() => {
    hoisted.calls.length = 0;
  });

  it('[entity:c4s-tools-ask] name, description verbatim, input fields and the { threadId, answer } response', async () => {
    const client = await connectClient('ws-5555');
    const { tools } = await client.listTools();
    const ask = tools.find((t) => t.name === 'ask');
    expect(ask).toBeDefined();
    // The entity's `description` goes into the tool definition word for word.
    expect(ask!.description).toBe(ASK_TOOL_DESCRIPTION);
    expect(ask!.description).toContain(
      "The peer answers read-only: it never edits the peer's pages or entities. To get a change into the peer's specification — including a project you use as a skill — ask for it: the peer leaves a plan on its side and the answer names that plan's path; nothing changes until the peer's author applies it.",
    );
    // 2.1.8 told the caller not to ask the peer for any write; 2.1.9 sends a change request there.
    expect(ask!.description).not.toContain('do not reach for this tool to make the other side write');

    const schema = ask!.inputSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(Object.keys(schema.properties).sort()).toEqual(
      ['effort', 'message', 'model', 'project', 'server', 'threadId', 'workspace'].sort(),
    );
    expect([...(schema.required ?? [])].sort()).toEqual(['message', 'project']);

    const res = await client.callTool({ name: 'ask', arguments: { message: 'ping', project: 'app-spec' } });
    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual({ threadId: 'peer-thread', answer: 'pong' });
  });

  /**
   * 2.1.26 — the re-rendered record: each param's description verbatim, `effort`
   * a closed choice `enum(low, medium, high)`, all four hints empty (the server
   * declares none), and the `logic`'s error path — a refusal before any peer
   * call, the caller's workspace by default, an agent error with its own code
   * and hint, anything else as `AGENT_ERROR`.
   */
  it('[entity:c4s-tools-ask] params as the 2.1.26 record lists them, effort a closed choice, no hints, and the error path its logic states', async () => {
    const client = await connectClient('ws-caller');
    const { tools } = await client.listTools();
    const ask = tools.find((t) => t.name === 'ask')!;
    const props = (ask.inputSchema as { properties: Record<string, { description?: string; type?: string; enum?: string[] }> })
      .properties;
    expect(props.message!.description).toBe('Question/prompt for the peer spec.');
    expect(props.project!.description).toBe("The peer project's `id`, exactly as <workspace_projects/> lists it. Not a path, not a name.");
    expect(props.workspace!.description).toBe("Another workspace to resolve `project` in; omitted = this server's workspace.");
    expect(props.server!.description).toBe('Peer server address override (e.g. its publicUrl). Valid only together with `project`.');
    expect(props.threadId!.description).toBe('Continue an existing peer thread.');
    expect(props.model!.description).toBe(
      "Peer turn model alias. Default: opus-5.5. The selectable list is the peer's own, published by its GET /api/chat/config. Resume-immutable. Passed through unvalidated here; a value the peer does not offer fails on the peer side.",
    );
    expect(props.model!.type).toBe('string');
    expect(props.model!.enum).toBeUndefined();
    expect(props.effort!.description).toBe(
      'Reasoning level for the peer turn, mapped to architectureConfig.claude_effort. Default: medium. Resume-immutable.',
    );
    expect(props.effort!.enum).toEqual(['low', 'medium', 'high']);
    // Empty hints: the server declares no annotations at all.
    const hints = (ask.annotations ?? {}) as Record<string, unknown>;
    for (const h of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) expect(hints[h], h).toBeUndefined();

    // Without `workspace` the caller's is taken; the call is a locked `ask` turn.
    hoisted.calls.length = 0;
    await client.callTool({ name: 'ask', arguments: { message: 'ping', project: 'app-spec' } });
    expect(hoisted.calls[0]).toMatchObject({ workspace: 'ws-caller', channel: 'mcp', contextType: 'ask', output: 'final' });

    // An agent error comes back with its own code and hint.
    vi.mocked(runAgent).mockImplementationOnce(async () => {
      throw new AgentError('RESUME_CONFIG_LOCKED', 'session config changed', 'send the first turn\'s config');
    });
    const locked = await client.callTool({ name: 'ask', arguments: { message: 'ping', project: 'app-spec', threadId: 't1' } });
    expect(locked.isError).toBe(true);
    expect(JSON.parse((locked.content as Array<{ text: string }>)[0].text)).toEqual({
      error: 'session config changed',
      code: 'RESUME_CONFIG_LOCKED',
      hint: "send the first turn's config",
    });

    // Anything else is AGENT_ERROR.
    vi.mocked(runAgent).mockImplementationOnce(async () => {
      throw new Error('socket hang up');
    });
    const other = await client.callTool({ name: 'ask', arguments: { message: 'ping', project: 'app-spec' } });
    expect(other.isError).toBe(true);
    expect(JSON.parse((other.content as Array<{ text: string }>)[0].text)).toMatchObject({ code: 'AGENT_ERROR', error: 'socket hang up' });
  });

  /**
   * 2.1.17 — `returns`: when the peer's turn left a plan, `answer` names its
   * project-relative path (in the text or in a closing ``Plan: `<path>` `` line)
   * and never the peer's directory. The peer's endpoint closes that form
   * (`routes/threads.test.ts`); this tool hands the peer's `{ threadId, answer }`
   * back as is — it neither drops the plan line nor rewrites the answer.
   */
  it('[entity:c4s-tools-ask] returns the peer\'s { threadId, answer } verbatim, closing Plan line included', async () => {
    const peerAnswer = 'I left a plan for the author.\n\nPlan: `.claude4spec/plans/rename-the-endpoint.md`';
    hoisted.nextAnswer = peerAnswer;
    const client = await connectClient('ws-5555');

    const res = await client.callTool({ name: 'ask', arguments: { message: 'Please rename it.', project: 'app-spec' } });

    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text: string }>;
    const body = JSON.parse(content[0].text) as { threadId: string; answer: string };
    expect(Object.keys(body).sort()).toEqual(['answer', 'threadId']);
    expect(body).toEqual({ threadId: 'peer-thread', answer: peerAnswer });
    expect(body.answer.split('\n').at(-1)).toBe('Plan: `.claude4spec/plans/rename-the-endpoint.md`');
    // Locked context: the peer turn is an `ask` turn with the final-only output.
    expect(hoisted.calls[0]).toMatchObject({ contextType: 'ask', output: 'final' });
  });

  /**
   * The peer's side of the rule: an `ask` turn may leave a plan (the profile
   * admits `create_plan` and mounts `plan-tools`) and may not edit pages or
   * entities (writes are gated out), and its interaction rules tell it that a
   * change request ENDS with a plan. The plan's path in the answer is pinned by
   * the endpoint tests in `routes/threads.test.ts`.
   */
  it('[ac:ac-tura-ask-z-prosba-o-zmiane-specyfikac] a change request to the peer ends in a plan on its side, never an edit', () => {
    expect(toolAdmittedByProfile('ask', 'create_plan')).toBe(true);
    expect(toolAdmittedByProfile('ask', 'update_plan')).toBe(true);
    expect(CONTEXT_TYPE_REGISTRY.ask.mcp.planTools).toBe(true);
    for (const write of ['create_page', 'update_page', 'create_tag', 'tag_entity']) {
      expect(toolAdmittedByProfile('ask', write), write).toBe(false);
    }
    expect(INTERACTION_RULES.ask).toContain('A request to CHANGE this specification ends with a plan, never with an edit');
    expect(ASK_TOOL_DESCRIPTION).toContain('the peer leaves a plan on its side');
  });
});
