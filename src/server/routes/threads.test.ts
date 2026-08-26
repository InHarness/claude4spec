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
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { ChatService } from '../services/chat.js';

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
      // 0.2.8 (C15): the resume guard resolves the turn's FS scope, which folds in the
      // page roots. No roots configured in this fixture — the artifact deny-set alone.
      roots: [],
    } as unknown as AgentTurnDeps;
    const router = threadsRouter(deps);
    return express().use(express.json()).use('/threads', router);
  };

  const lastArchitectureConfig = () => runAgentTurnMock.mock.calls.at(-1)?.[1].architectureConfig;

  it("adaptive model (opus-5) + effort -> claude_thinking: 'adaptive', no budget", async () => {
    const res = await request(app())
      .post(`/threads/${thread.id}/ask`)
      .send({ message: 'hi', model: 'opus-5', effort: 'high' });
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
    "non-adaptive model (haiku-4.5) + effort '%s' -> claude_thinking: 'enabled', budget %i",
    async (effort, budget) => {
      const res = await request(app())
        .post(`/threads/${thread.id}/ask`)
        .send({ message: 'hi', model: 'haiku-4.5', effort });
      expect(res.status).toBe(200);
      expect(lastArchitectureConfig()).toMatchObject({
        claude_effort: effort,
        claude_thinking: 'enabled',
        claude_thinking_budget: budget,
      });
    },
  );

  it("adaptive model (sonnet-5) + effort -> claude_thinking: 'adaptive', no budget", async () => {
    const res = await request(app())
      .post(`/threads/${thread.id}/ask`)
      .send({ message: 'hi', model: 'sonnet-5', effort: 'medium' });
    expect(res.status).toBe(200);
    expect(lastArchitectureConfig()).toMatchObject({
      claude_effort: 'medium',
      claude_thinking: 'adaptive',
    });
    expect(lastArchitectureConfig()).not.toHaveProperty('claude_thinking_budget');
  });

  /**
   * The default is `opus-5`, which is ADAPTIVE — so this case flipped branches
   * in 0.2.17. It used to assert the budget path, because the default was the
   * mid-tier non-adaptive model; `haiku-4.5` is the only non-adaptive alias
   * left, and nothing resolves to it implicitly.
   */
  it('no explicit model (defaults to opus-5) + effort behaves like the adaptive case', async () => {
    const res = await request(app()).post(`/threads/${thread.id}/ask`).send({ message: 'hi', effort: 'low' });
    expect(res.status).toBe(200);
    expect(lastArchitectureConfig()).toMatchObject({
      claude_effort: 'low',
      claude_thinking: 'adaptive',
    });
    expect(lastArchitectureConfig()).not.toHaveProperty('claude_thinking_budget');
  });

  it('no effort in body -> none of claude_effort/claude_thinking/claude_thinking_budget are set (adaptive model)', async () => {
    const res = await request(app()).post(`/threads/${thread.id}/ask`).send({ message: 'hi', model: 'opus-5' });
    expect(res.status).toBe(200);
    const cfg = lastArchitectureConfig();
    expect(cfg).not.toHaveProperty('claude_effort');
    expect(cfg).not.toHaveProperty('claude_thinking');
    expect(cfg).not.toHaveProperty('claude_thinking_budget');
  });

  it('no effort in body -> none of claude_effort/claude_thinking/claude_thinking_budget are set (non-adaptive model)', async () => {
    const res = await request(app()).post(`/threads/${thread.id}/ask`).send({ message: 'hi', model: 'haiku-4.5' });
    expect(res.status).toBe(200);
    const cfg = lastArchitectureConfig();
    expect(cfg).not.toHaveProperty('claude_effort');
    expect(cfg).not.toHaveProperty('claude_thinking');
    expect(cfg).not.toHaveProperty('claude_thinking_budget');
  });

  it('invalid effort value -> 400 VALIDATION, runAgentTurn never invoked', async () => {
    const res = await request(app())
      .post(`/threads/${thread.id}/ask`)
      .send({ message: 'hi', model: 'haiku-4.5', effort: 'ultra' });
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
        model: 'haiku-4.5',
        architectureConfig: { claude_effort: 'medium', claude_thinking: 'enabled', claude_thinking_budget: 8192 },
      });
      const res = await request(app())
        .post(`/threads/${thread.id}/ask`)
        .send({ message: 'hi', model: 'haiku-4.5', effort: 'high' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RESUME_CONFIG_LOCKED');
      expect(res.body.error.violations.length).toBeGreaterThan(0);
      expect(runAgentTurnMock).not.toHaveBeenCalled();
    });

    it('no violation (200) when resuming with the same effort/model', async () => {
      initialArchitectureConfigSnapshot = JSON.stringify({
        model: 'haiku-4.5',
        architectureConfig: { claude_effort: 'medium', claude_thinking: 'enabled', claude_thinking_budget: 8192 },
      });
      const res = await request(app())
        .post(`/threads/${thread.id}/ask`)
        .send({ message: 'hi', model: 'haiku-4.5', effort: 'medium' });
      expect(res.status).toBe(200);
      expect(runAgentTurnMock).toHaveBeenCalledTimes(1);
    });
  });

  // 0.2.8 (C15): the FS path scope is resume-immutable too. Before this, changing
  // `agent.allowedPaths` in Settings and resuming a thread silently ran the turn under a
  // different scope than the session was created with — the guard had nothing to compare.
  describe('resume guard — FS path scope (C15)', () => {
    /** Write `.claude4spec/config.json` into the fixture cwd. */
    const writeConfig = (cfg: Record<string, unknown>) => {
      fs.mkdirSync(path.join(dir, '.claude4spec'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude4spec', 'config.json'), JSON.stringify(cfg));
    };
    const snapshotWith = (paths: { allowedPaths?: string[]; disallowedPaths?: string[] }) =>
      JSON.stringify({ model: 'opus-5', architectureConfig: {}, ...paths });

    beforeEach(() => {
      thread = makeThread({ lastSessionId: 'sess-1' });
    });

    it('409 RESUME_CONFIG_LOCKED when agent.allowedPaths changed since turn 1', async () => {
      writeConfig({ agent: { allowedPaths: ['new'] } });
      initialArchitectureConfigSnapshot = snapshotWith({
        allowedPaths: [path.join(dir, 'old')],
      });
      const res = await request(app())
        .post(`/threads/${thread.id}/ask`)
        .send({ message: 'hi', model: 'opus-5' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RESUME_CONFIG_LOCKED');
      // `violations[]` names the field, so the UI can lock the right control; `message`
      // stays the one static string, identical here and on POST /api/chat.
      expect(res.body.error.violations.map((v: { path: string }) => v.path)).toContain(
        'allowedPaths',
      );
      expect(res.body.error.message).toBe(
        'Model, reasoning and filesystem scope are locked for the lifetime of a session. Start a new conversation to use the new settings.',
      );
      expect(runAgentTurnMock).not.toHaveBeenCalled();
    });

    it('409 when agent.disallowedPaths changed since turn 1', async () => {
      writeConfig({ agent: { disallowedPaths: ['secrets'] } });
      // Snapshot holds only the artifact deny-set — the user entry is new.
      initialArchitectureConfigSnapshot = snapshotWith({
        disallowedPaths: ['plans', 'briefs', 'patches', 'entities', 'releases']
          .map((d) => path.join(dir, '.claude4spec', d))
          .sort(),
      });
      const res = await request(app())
        .post(`/threads/${thread.id}/ask`)
        .send({ message: 'hi', model: 'opus-5' });
      expect(res.status).toBe(409);
      expect(res.body.error.violations.map((v: { path: string }) => v.path)).toContain(
        'disallowedPaths',
      );
    });

    it('no 409 when the same paths are merely REORDERED (set comparison, not array)', async () => {
      // The user reordered the list in Settings: turn 1 ran with ['a','b'], the config now
      // says ['b','a']. The snapshot holds turn 1's value in the canonical (sorted) form
      // the writer produces. Without `normalizeResumePathScope` on the current-turn side
      // the guard would compare ['/a','/b'] against ['/b','/a'] — the library diffs by
      // JSON.stringify — and raise a bogus 409. Do NOT sort the snapshot literal here:
      // that would make this test pass with the normalization removed.
      writeConfig({ agent: { allowedPaths: ['b', 'a'] } });
      initialArchitectureConfigSnapshot = snapshotWith({
        allowedPaths: [path.join(dir, 'a'), path.join(dir, 'b')],
      });
      const res = await request(app())
        .post(`/threads/${thread.id}/ask`)
        .send({ message: 'hi', model: 'opus-5' });
      expect(res.status).toBe(200);
      expect(runAgentTurnMock).toHaveBeenCalledTimes(1);
    });

    it('no 409 for a pre-0.2.8 snapshot that has no path fields (back-compat)', async () => {
      writeConfig({ agent: { allowedPaths: ['anything'] } });
      initialArchitectureConfigSnapshot = JSON.stringify({
        model: 'opus-5',
        architectureConfig: {},
      });
      const res = await request(app())
        .post(`/threads/${thread.id}/ask`)
        .send({ message: 'hi', model: 'opus-5' });
      expect(res.status).toBe(200);
    });

    it('a NEW thread (no session yet) starts on the current scope with no error', async () => {
      writeConfig({ agent: { allowedPaths: ['whatever'] } });
      thread = makeThread({ lastSessionId: null });
      initialArchitectureConfigSnapshot = null;
      const res = await request(app())
        .post(`/threads/${thread.id}/ask`)
        .send({ message: 'hi', model: 'opus-5' });
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
      // 0.2.8 (C15): the resume guard resolves the turn's FS scope, which folds in the
      // page roots. No roots configured in this fixture — the artifact deny-set alone.
      roots: [],
    } as unknown as AgentTurnDeps;
    const app = express().use(express.json()).use('/threads', threadsRouter(deps));

    const res = await request(app).post(`/threads/${thread.id}/ask`).send({ message: 'hi' });

    expect(res.status).toBe(200);
    expect(runAgentTurnMock.mock.calls.at(-1)?.[1].timeoutMs).toBe(ASK_TURN_TIMEOUT_MS);
  });
});

/**
 * 0.2.52: DETAIL-ONLY projection. `subagentTasks` / `backgroundTasks` ride the
 * detail handler, exactly like `queuedMessages` — deliberately NOT
 * `hydrateThread()`. The rule binds both ways, so both directions are pinned
 * here: the detail response carries them, and the list response neither carries
 * them nor reads their table.
 *
 * Moving either into `hydrateThread()` would subject it to the list's
 * performance contract — one extra query per listed row, for no reader at all.
 *
 * Unlike the mocked fixtures above, these run against a real ChatService over a
 * real in-memory DB: the point is what the projection ACTUALLY queries.
 */
describe('GET /threads — detail-only projection of task collections (0.2.52)', () => {
  let db: Database.Database;
  let chat: ChatService;
  let dir: string;

  const app = () => {
    const deps = {
      chatService: chat,
      agentCredentialService: { getDecrypted: () => null },
      activeAdapters: new Map(),
      cwd: dir,
      roots: [],
    } as unknown as AgentTurnDeps;
    return express().use(express.json()).use('/threads', threadsRouter(deps));
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-threads-detail-'));
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    chat = new ChatService(db);
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns backgroundTasks on the detail route, oldest first', async () => {
    const t = chat.createThread('t');
    chat.startBackgroundTask(t.id, 'bg1', 'shell', 'npm run build');
    chat.startBackgroundTask(t.id, 'bg2', 'monitor', 'watch');
    // Backdate the SECOND-inserted row: created_at order must differ from
    // insertion order, or an unsorted projection passes this case unchanged
    // (SQLite hands back rowid order when no ORDER BY applies).
    db.prepare(
      `UPDATE chat_background_task SET created_at = datetime('now', '-1 hour')
        WHERE thread_id = ? AND task_id = 'bg2'`,
    ).run(t.id);
    chat.completeBackgroundTask(t.id, 'bg1', 'shell', 'exited 0', '/tmp/bg1.log', 'built');

    const res = await request(app()).get(`/threads/${t.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.backgroundTasks).toEqual([
      expect.objectContaining({ taskId: 'bg2', taskType: 'monitor', status: 'running' }),
      expect.objectContaining({
        taskId: 'bg1',
        taskType: 'shell',
        // Verbatim, not classified — the wire type is a bare undocumented string.
        status: 'exited 0',
        outputFile: '/tmp/bg1.log',
        summary: 'built',
      }),
    ]);
    expect(res.body.data.subagentTasks).toEqual([]);
  });

  it('returns an empty array for a thread that never backgrounded anything', async () => {
    const t = chat.createThread('t');
    const res = await request(app()).get(`/threads/${t.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.backgroundTasks).toEqual([]);
  });

  it('omits both collections from the list, and never reads the table for it', async () => {
    const t = chat.createThread('t');
    chat.startBackgroundTask(t.id, 'bg1', 'shell', 'npm run build');
    const listBackgroundTasks = vi.spyOn(chat, 'listBackgroundTasks');
    const listSubagentTasks = vi.spyOn(chat, 'listSubagentTasks');

    const res = await request(app()).get('/threads');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    // Absent, not empty: a list consumer must not be able to reach for them.
    expect(res.body.data[0]).not.toHaveProperty('backgroundTasks');
    expect(res.body.data[0]).not.toHaveProperty('subagentTasks');
    expect(listBackgroundTasks).not.toHaveBeenCalled();
    expect(listSubagentTasks).not.toHaveBeenCalled();
  });
});
