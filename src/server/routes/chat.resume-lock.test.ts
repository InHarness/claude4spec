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

  /**
   * 0.2.50 item 11 — a DELIBERATE omission, guarded here because it looks like a
   * bug to anyone tidying the snapshot.
   *
   * The library declares `disallowedToolGroups` (and therefore `planMode`) as
   * resume-immutable. claude4spec deliberately excludes it from the turn-1
   * config snapshot so the Plan Mode toggle keeps working on a resumed thread,
   * in BOTH directions. Adding the field "for consistency" would silently turn
   * every plan-mode toggle on an existing conversation into a 409.
   *
   * The accepted risk is named rather than hidden: turning plan mode OFF
   * mid-thread hands the model shell access after it has already read the
   * transcript.
   */
  it('does NOT lock plan mode on a resumed thread — the toggle stays live', async () => {
    thread = makeThread({ lastSessionId: 'sess-1', planMode: false });
    snapshot = JSON.stringify({ model: 'opus-5', architectureConfig: {} });

    const res = await post({ model: 'opus-5', planMode: true });

    expect(res.status).not.toBe(409);
    expect(runAgentTurnMock).toHaveBeenCalled();
  });

  /**
   * 0.2.53 — the pair that makes the guard's design decision observable.
   *
   * `agent.disableDirectFilesystemAccess` and `planMode` desugar into
   * OVERLAPPING deny-groups, so a guard that compared the resolved union could
   * not tell them apart: it would 409 on a plan-mode toggle. The guard compares
   * the CONFIG FIELD from the turn-1 snapshot instead, and these two tests pin
   * both halves of that — the flag locks, the toggle does not.
   */
  it('[ac:ac-wznowienie-watku-zalozonego-przy-inne] 409s when disableDirectFilesystemAccess changed since turn 1', async () => {
    writeConfig({ agent: { disableDirectFilesystemAccess: false } });
    snapshot = JSON.stringify({
      model: 'opus-5',
      architectureConfig: {},
      disableDirectFilesystemAccess: true,
    });

    const res = await post({ model: 'opus-5' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESUME_CONFIG_LOCKED');
    expect(res.body.error.violations.map((v: { path: string }) => v.path)).toContain(
      'agent.disableDirectFilesystemAccess',
    );
    expect(runAgentTurnMock).not.toHaveBeenCalled();
  });

  it('[ac:ac-flip-plan-mode-w-srodku-watku-nie-pow] does NOT 409 on a plan-mode flip while the flag is unchanged', async () => {
    writeConfig({ agent: { disableDirectFilesystemAccess: true } });
    snapshot = JSON.stringify({
      model: 'opus-5',
      architectureConfig: {},
      disableDirectFilesystemAccess: true,
    });
    thread = makeThread({ lastSessionId: 'sess-1', planMode: false });

    const res = await post({ model: 'opus-5', planMode: true });

    expect(res.status).not.toBe(409);
    expect(runAgentTurnMock).toHaveBeenCalled();
  });

  /**
   * A thread started before the field existed has no value to compare against,
   * so nothing is locked — the same "absent ⇒ not comparable" rule the library
   * applies to every other constraint. Without this, shipping 0.2.53 would make
   * every pre-existing conversation unresumable in one step.
   */
  it('does not lock a pre-0.2.53 snapshot that has no flag recorded', async () => {
    writeConfig({ agent: { disableDirectFilesystemAccess: false } });
    snapshot = JSON.stringify({ model: 'opus-5', architectureConfig: {} });

    const res = await post({ model: 'opus-5' });

    expect(res.status).not.toBe(409);
    expect(runAgentTurnMock).toHaveBeenCalled();
  });

  /** The snapshot must not carry the field in the first place. */
  it('keeps planMode and disallowedToolGroups out of the turn-1 config snapshot', async () => {
    thread = makeThread({ lastSessionId: 'sess-1' });
    snapshot = JSON.stringify({ model: 'opus-5', architectureConfig: {} });

    await post({ model: 'opus-5', planMode: true });

    const [, input] = runAgentTurnMock.mock.calls.at(-1) as [
      unknown,
      { architectureConfig?: Record<string, unknown> },
    ];
    expect(input.architectureConfig ?? {}).not.toHaveProperty('planMode');
    expect(input.architectureConfig ?? {}).not.toHaveProperty('disallowedToolGroups');
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
