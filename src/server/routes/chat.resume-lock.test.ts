import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { chatRouter } from './chat.js';
import type { AgentTurnDeps } from './agent-turn.js';
import type { ChatThreadMeta } from '../../shared/entities.js';

/**
 * M05 item 33 requires BOTH turn-starting routes to carry their own coverage of the
 * session lock — not just the shared helper and not just `POST /api/threads/:id/ask`.
 * The guard was once two byte-identical inline copies of which only one was tested, and
 * the untested one (headless `c4s ask`) was quietly unguarded for a while. A shared
 * helper removes the drift but not the need to prove each route actually calls it, in
 * the right place: the 409 must be produced BEFORE the SSE headers are flushed, because
 * after the flush the status can no longer be set and the client would see a 200 stream
 * carrying an error event instead.
 */
const runAgentTurnMock = vi.hoisted(() =>
  vi.fn(async (_deps: unknown, input: { thread: { id: string } }) => ({
    threadId: input.thread.id,
    answer: 'ok',
    messages: [],
  })),
);
vi.mock('./agent-turn.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./agent-turn.js')>();
  return { ...actual, runAgentTurn: runAgentTurnMock };
});

const STATIC_MESSAGE =
  'Model, reasoning and filesystem scope are locked for the lifetime of a session. Start a new conversation to use the new settings.';

function makeThread(overrides: Partial<ChatThreadMeta> = {}): ChatThreadMeta {
  return {
    id: 't1',
    title: null,
    lastSessionId: 'sess-1',
    initialArchitectureConfig: null,
    currentTodoItems: null,
    planMode: false,
    usage: null,
    contextSize: null,
    planPath: null,
    hasSystemPrompt: false,
    contextType: 'chat',
    briefPath: null,
    patchPath: null,
    parentThreadId: null,
    spawnedByToolUseId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    messageCount: 0,
    ...overrides,
  };
}

describe('POST /api/chat — RESUME_CONFIG_LOCKED wiring (M05 item 33)', () => {
  let dir: string;
  let thread: ChatThreadMeta;
  let snapshot: string | null;

  const writeConfig = (cfg: Record<string, unknown>) => {
    fs.mkdirSync(path.join(dir, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude4spec', 'config.json'), JSON.stringify(cfg));
  };

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-chat-resume-')));
    thread = makeThread();
    snapshot = null;
    runAgentTurnMock.mockClear();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const app = () => {
    const deps = {
      chatService: {
        getThreadMeta: (id: string) => (id === thread.id ? thread : null),
        createThread: () => thread,
        getInitialArchitectureConfig: () => snapshot,
        updateThreadSettings: () => thread,
        clearQueued: () => [],
      },
      agentCredentialService: { getDecrypted: () => null },
      activeAdapters: new Map(),
      pendingInputs: new Map(),
      cwd: dir,
      roots: [],
    } as unknown as AgentTurnDeps;
    return express().use(express.json()).use('/chat', chatRouter(deps));
  };

  const post = (body: Record<string, unknown>) =>
    request(app()).post('/chat').send({ prompt: 'hi', threadId: thread.id, ...body });

  it('409s with the static message and a dynamic violations[] when the FS scope changed', async () => {
    writeConfig({ agent: { allowedPaths: ['new'] } });
    snapshot = JSON.stringify({
      model: 'opus-5',
      architectureConfig: {},
      allowedPaths: [path.join(dir, 'old')],
    });

    const res = await post({ model: 'opus-5' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESUME_CONFIG_LOCKED');
    expect(res.body.error.message).toBe(STATIC_MESSAGE);
    expect(res.body.error.violations.map((v: { path: string }) => v.path)).toContain(
      'allowedPaths',
    );
    // A JSON 409, not an SSE stream — proof the guard ran before the headers flushed.
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(runAgentTurnMock).not.toHaveBeenCalled();
  });

  it('409s on a model change', async () => {
    snapshot = JSON.stringify({ model: 'haiku-4.5', architectureConfig: {} });

    // Must be a member of ALLOWED_MODELS — the route silently coerces anything else
    // back to the default, which would make this assert nothing.
    const res = await post({ model: 'opus-5' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(STATIC_MESSAGE);
    expect(res.body.error.violations.map((v: { path: string }) => v.path)).toContain('model');
    expect(runAgentTurnMock).not.toHaveBeenCalled();
  });

  it('lets a turn through when nothing locked has changed', async () => {
    writeConfig({ agent: { allowedPaths: ['same'] } });
    snapshot = JSON.stringify({
      model: 'opus-5',
      architectureConfig: {},
      allowedPaths: [path.join(dir, 'same')],
    });

    const res = await post({ model: 'opus-5' });

    expect(res.status).not.toBe(409);
    expect(runAgentTurnMock).toHaveBeenCalled();
  });

  it('does not lock a thread that is not resuming', async () => {
    thread = makeThread({ lastSessionId: null });
    writeConfig({ agent: { allowedPaths: ['whatever'] } });
    snapshot = JSON.stringify({ model: 'haiku-4.5', architectureConfig: {} });

    const res = await post({ model: 'opus-5' });

    expect(res.status).not.toBe(409);
  });
});
