import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildC4sToolsServer } from './c4s-tools.js';
import { runAsk_cli } from '../../bin/c4s/commands/ask.js';
import { parseArgs } from '../../bin/c4s/args.js';
import { WorkspaceRegistry } from '../workspace/registry.js';
import { consultationContextType } from '../services/context-types/registry.js';
import { startConsultationPeer, type ConsultationPeer } from '../../../tests/helpers/consultation-peer.js';

/**
 * 2.1.88 (M11 `m11dcore`) — the two consultation transports run one engine
 * (`runAgent`) against a live peer: real thread routes and store; only the
 * agent turn is mocked. Neither transport writes a context-type value: the
 * peer founds the thread through the consultation entry.
 */
const turnMock = vi.hoisted(() =>
  vi.fn(async (_deps: unknown, input: { thread: { id: string } }) => ({
    threadId: input.thread.id,
    answer: 'POST /api/things returns 201 with the created thing.',
    messages: [{ role: 'assistant', content: 'POST /api/things returns 201 with the created thing.' }],
  })),
);
vi.mock('../routes/agent-turn.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../routes/agent-turn.js')>();
  return { ...actual, runAgentTurn: turnMock };
});

describe('c4s-tools.ask and c4s ask — one engine, the consultation entry (2.1.88)', () => {
  let home: string;
  let prevHome: string | undefined;
  let peer: ConsultationPeer;
  let workspace: string;

  beforeEach(async () => {
    turnMock.mockClear();
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-consult-home-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = home;
    peer = await startConsultationPeer({ projectId: 'peer' });
    // The peer registered in a workspace whose local address is the live server.
    const registry = new WorkspaceRegistry(home);
    const ws = registry.selectOrCreate({ name: 'ws-peer', port: peer.port });
    workspace = ws.name;
    const record = registry.registerProject(ws, path.join(home, 'projects', 'peer'));
    expect(record.id).toBe(peer.projectId);
  });
  afterEach(async () => {
    await peer.close();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  async function mcpAsk(args: Record<string, unknown>): Promise<{ isError: boolean; body: Record<string, unknown> }> {
    const { server } = buildC4sToolsServer(workspace);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const res = await client.callTool({ name: 'ask', arguments: args });
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    return { isError: res.isError === true, body: JSON.parse(text) as Record<string, unknown> };
  }

  async function cliAsk(message: string): Promise<Record<string, unknown>> {
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    try {
      await runAsk_cli(parseArgs(['ask', message, '--project', peer.projectId, '--workspace', workspace]));
    } finally {
      spy.mockRestore();
    }
    return JSON.parse(out.join('')) as Record<string, unknown>;
  }

  it('[ac:ac-mcp-tool-c4s-tools-ask-z-minimalnym-ws] `{ message, project }` returns `{ threadId, answer }` exactly like `c4s ask "msg" --project <id>`', async () => {
    const viaMcp = await mcpAsk({ message: 'What does POST /api/things return?', project: peer.projectId });
    expect(viaMcp.isError).toBe(false);
    const viaCli = await cliAsk('What does POST /api/things return?');

    const [mcpThread, cliThread] = peer.threads();
    expect(viaMcp.body).toEqual({ threadId: mcpThread!.id, answer: 'POST /api/things returns 201 with the created thing.' });
    expect(viaCli).toEqual({ threadId: cliThread!.id, answer: 'POST /api/things returns 201 with the created thing.' });
    // Same shape, same answer; each call founded its own consultation thread in
    // the same value — the one the peer's registry gives the consultation entry.
    expect(Object.keys(viaMcp.body).sort()).toEqual(Object.keys(viaCli).sort());
    expect(viaMcp.body.answer).toBe(viaCli.answer);
    for (const row of [mcpThread!, cliThread!]) {
      expect(row.context_type).toBe(consultationContextType());
      expect(row.consultation).toBe(1);
    }
  });

  it('[entity:c4s-tools-ask] a peer without a `Wejście: konsultacja` value refuses with PROJECT_WITHOUT_CONSULTATION, as the logic states', async () => {
    await peer.close();
    peer = await startConsultationPeer({ projectId: 'peer', contextTypes: ['chat', 'brief', 'patch'] });
    const registry = new WorkspaceRegistry(home);
    // Re-point the workspace at the new server.
    registry.registerProject(
      registry.selectOrCreate({ name: 'ws-peer-2', port: peer.port }),
      path.join(home, 'projects2', 'peer'),
    );
    workspace = 'ws-peer-2';

    const res = await mcpAsk({ message: 'q', project: peer.projectId });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('PROJECT_WITHOUT_CONSULTATION');
    expect(peer.threads()).toHaveLength(0);
    expect(turnMock).not.toHaveBeenCalled();
  });
});
