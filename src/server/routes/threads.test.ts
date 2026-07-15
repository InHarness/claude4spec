import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { threadsRouter } from './threads.js';
import type { AgentTurnDeps } from './agent-turn.js';
import type { ChatThreadMeta } from '../../shared/entities.js';
import { ASK_TURN_TIMEOUT_MS } from '../../shared/agent-turn.js';

// 0.1.107: threads.ts's `POST /:id/ask` now branches on model adaptivity (mirrors
// the client's `thinkingToConfig`) instead of only setting `claude_effort`.
// `runAgentTurn` does a huge amount of unrelated work (system prompt, MCP wiring,
// persistence) so it's mocked here — only the `architectureConfig` it receives is
// under test. `findResumeViolations`/`resolveModel`/`ADAPTIVE_THINKING_ONLY` stay
// real (pure, cheap) so the resume-guard interaction is exercised for real.
const runAgentTurnMock = vi.hoisted(() =>
  vi.fn(async (_deps: unknown, input: { thread: { id: string }; architectureConfig: Record<string, unknown> }) => ({
    threadId: input.thread.id,
    answer: 'ok',
    messages: [],
  })),
);
vi.mock('./agent-turn.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./agent-turn.js')>();
  return { ...actual, runAgentTurn: runAgentTurnMock };
});

function makeThread(overrides: Partial<ChatThreadMeta> = {}): ChatThreadMeta {
  return {
    id: 't1',
    title: null,
    lastSessionId: null,
    initialArchitectureConfig: null,
    currentTodoItems: null,
    planMode: false,
    usage: null,
    contextSize: null,
    planPath: null,
    hasSystemPrompt: false,
    contextType: 'ask',
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

describe('POST /:id/ask — server-side reasoning resolution (0.1.107)', () => {
  let dir: string;
  let thread: ChatThreadMeta;
  let initialArchitectureConfigSnapshot: string | null;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-threads-route-'));
    thread = makeThread();
    initialArchitectureConfigSnapshot = null;
    runAgentTurnMock.mockClear();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const app = () => {
    const deps = {
      chatService: {
        getThreadMeta: (id: string) => (id === thread.id ? thread : null),
        getInitialArchitectureConfig: () => initialArchitectureConfigSnapshot,
      },
      agentCredentialService: { getDecrypted: () => null },
      activeAdapters: new Map(),
      cwd: dir,
    } as unknown as AgentTurnDeps;
    const router = threadsRouter(deps);
    return express().use(express.json()).use('/threads', router);
  };

  const lastArchitectureConfig = () => runAgentTurnMock.mock.calls.at(-1)?.[1].architectureConfig;

  it("adaptive model (opus-4.8) + effort -> claude_thinking: 'adaptive', no budget", async () => {
    const res = await request(app())
      .post(`/threads/${thread.id}/ask`)
      .send({ message: 'hi', model: 'opus-4.8', effort: 'high' });
    expect(res.status).toBe(200);
    expect(lastArchitectureConfig()).toMatchObject({ claude_effort: 'high', claude_thinking: 'adaptive' });
    expect(lastArchitectureConfig()).not.toHaveProperty('claude_thinking_budget');
  });

  it("adaptive model (fable-5) + effort -> claude_thinking: 'adaptive', no budget", async () => {
    const res = await request(app())
      .post(`/threads/${thread.id}/ask`)
      .send({ message: 'hi', model: 'fable-5', effort: 'low' });
    expect(res.status).toBe(200);
    expect(lastArchitectureConfig()).toMatchObject({ claude_effort: 'low', claude_thinking: 'adaptive' });
    expect(lastArchitectureConfig()).not.toHaveProperty('claude_thinking_budget');
  });

  it.each([
    ['low', 2048],
    ['medium', 8192],
    ['high', 24000],
  ] as const)(
    "non-adaptive model (sonnet-4.6) + effort '%s' -> claude_thinking: 'enabled', budget %i",
    async (effort, budget) => {
      const res = await request(app())
        .post(`/threads/${thread.id}/ask`)
        .send({ message: 'hi', model: 'sonnet-4.6', effort });
      expect(res.status).toBe(200);
      expect(lastArchitectureConfig()).toMatchObject({
        claude_effort: effort,
        claude_thinking: 'enabled',
        claude_thinking_budget: budget,
      });
    },
  );

  it("non-adaptive model (haiku-4.5) + effort -> claude_thinking: 'enabled' + budget", async () => {
    const res = await request(app())
      .post(`/threads/${thread.id}/ask`)
      .send({ message: 'hi', model: 'haiku-4.5', effort: 'medium' });
    expect(res.status).toBe(200);
    expect(lastArchitectureConfig()).toMatchObject({
      claude_effort: 'medium',
      claude_thinking: 'enabled',
      claude_thinking_budget: 8192,
    });
  });

  it('no explicit model (defaults to sonnet-4.6) + effort behaves like the non-adaptive case', async () => {
    const res = await request(app()).post(`/threads/${thread.id}/ask`).send({ message: 'hi', effort: 'low' });
    expect(res.status).toBe(200);
    expect(lastArchitectureConfig()).toMatchObject({
      claude_effort: 'low',
      claude_thinking: 'enabled',
      claude_thinking_budget: 2048,
    });
  });

  it('no effort in body -> none of claude_effort/claude_thinking/claude_thinking_budget are set (adaptive model)', async () => {
    const res = await request(app()).post(`/threads/${thread.id}/ask`).send({ message: 'hi', model: 'opus-4.8' });
    expect(res.status).toBe(200);
    const cfg = lastArchitectureConfig();
    expect(cfg).not.toHaveProperty('claude_effort');
    expect(cfg).not.toHaveProperty('claude_thinking');
    expect(cfg).not.toHaveProperty('claude_thinking_budget');
  });

  it('no effort in body -> none of claude_effort/claude_thinking/claude_thinking_budget are set (non-adaptive model)', async () => {
    const res = await request(app()).post(`/threads/${thread.id}/ask`).send({ message: 'hi', model: 'sonnet-4.6' });
    expect(res.status).toBe(200);
    const cfg = lastArchitectureConfig();
    expect(cfg).not.toHaveProperty('claude_effort');
    expect(cfg).not.toHaveProperty('claude_thinking');
    expect(cfg).not.toHaveProperty('claude_thinking_budget');
  });

  it('invalid effort value -> 400 VALIDATION, runAgentTurn never invoked', async () => {
    const res = await request(app())
      .post(`/threads/${thread.id}/ask`)
      .send({ message: 'hi', model: 'sonnet-4.6', effort: 'ultra' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(runAgentTurnMock).not.toHaveBeenCalled();
  });

  describe('resume guard interaction', () => {
    beforeEach(() => {
      thread = makeThread({ lastSessionId: 'sess-1' });
    });

    it('409 RESUME_CONFIG_LOCKED when resuming with a different effort (different budget) on the same non-adaptive model', async () => {
      initialArchitectureConfigSnapshot = JSON.stringify({
        model: 'sonnet-4.6',
        architectureConfig: { claude_effort: 'medium', claude_thinking: 'enabled', claude_thinking_budget: 8192 },
      });
      const res = await request(app())
        .post(`/threads/${thread.id}/ask`)
        .send({ message: 'hi', model: 'sonnet-4.6', effort: 'high' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RESUME_CONFIG_LOCKED');
      expect(res.body.error.violations.length).toBeGreaterThan(0);
      expect(runAgentTurnMock).not.toHaveBeenCalled();
    });

    it('no violation (200) when resuming with the same effort/model', async () => {
      initialArchitectureConfigSnapshot = JSON.stringify({
        model: 'sonnet-4.6',
        architectureConfig: { claude_effort: 'medium', claude_thinking: 'enabled', claude_thinking_budget: 8192 },
      });
      const res = await request(app())
        .post(`/threads/${thread.id}/ask`)
        .send({ message: 'hi', model: 'sonnet-4.6', effort: 'medium' });
      expect(res.status).toBe(200);
      expect(runAgentTurnMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe('POST /:id/ask — headless-only turn timeout (0-1-110-to-next)', () => {
  let dir: string;
  let thread: ChatThreadMeta;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-threads-route-'));
    thread = makeThread();
    runAgentTurnMock.mockClear();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('passes ASK_TURN_TIMEOUT_MS into runAgentTurn — unlike interactive POST /api/chat, no human is present to keep a stuck turn alive', async () => {
    const deps = {
      chatService: {
        getThreadMeta: (id: string) => (id === thread.id ? thread : null),
        getInitialArchitectureConfig: () => null,
      },
      agentCredentialService: { getDecrypted: () => null },
      activeAdapters: new Map(),
      cwd: dir,
    } as unknown as AgentTurnDeps;
    const app = express().use(express.json()).use('/threads', threadsRouter(deps));

    const res = await request(app).post(`/threads/${thread.id}/ask`).send({ message: 'hi' });

    expect(res.status).toBe(200);
    expect(runAgentTurnMock.mock.calls.at(-1)?.[1].timeoutMs).toBe(ASK_TURN_TIMEOUT_MS);
  });
});
