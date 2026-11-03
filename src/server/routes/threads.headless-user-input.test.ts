import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import type { UserInputRequest, UserInputResponse } from '@inharness-ai/agent-adapters';
import { threadsRouter } from './threads.js';
import type { ActiveAdapter, AgentTurnDeps, AgentTurnInput, PendingInput } from './agent-turn.js';
import { ChatService } from '../services/chat.js';
import { runMigrations } from '../db/migrate.js';
import { HEADLESS_TURN_PROMPT_NOTE, HEADLESS_USER_INPUT_GUIDANCE } from './headless-user-input.js';

/**
 * M05 `dhf17oo0` (Pytanie agenta bez klienta) — the agent asks during a headless
 * turn (`POST /api/threads/:id/ask`, the only path of the `ask` operation).
 *
 * The turn is a stand-in for the adapter: it asks through `input.onUserInput` —
 * the handler the claude-code adapter calls for `AskUserQuestion` (`model-tool`)
 * and for MCP elicitation (`mcp-elicitation`) — and goes on with whatever answer
 * it gets. Nobody ever calls `POST /api/chat/user-input` here.
 */
const TOOL_QUESTION = {
  requestId: 'q-tool',
  source: 'model-tool',
  origin: 'claude-code',
  questions: [{ question: 'Which module first?', options: [{ label: 'M05' }, { label: 'M53' }] }],
} as unknown as UserInputRequest;

const MCP_QUESTION = {
  requestId: 'q-mcp',
  source: 'mcp-elicitation',
  origin: 'c4s-spec',
  questions: [{ question: 'Confirm the slug?' }],
} as unknown as UserInputRequest;

const turn = vi.hoisted(() => ({
  answers: [] as unknown[],
  rolesBeforeAnswer: [] as string[][],
  inputs: [] as AgentTurnInput[],
  chat: null as null | { getMessages: (id: string) => { role: string }[] },
}));

vi.mock('./agent-turn.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./agent-turn.js')>();
  return {
    ...actual,
    runAgentTurn: vi.fn(async (_deps: unknown, input: AgentTurnInput) => {
      turn.inputs.push(input);
      for (const q of [TOOL_QUESTION, MCP_QUESTION]) {
        const answer = await input.onUserInput!(q);
        turn.rolesBeforeAnswer.push(turn.chat!.getMessages(input.thread.id).map((m) => m.role));
        turn.answers.push(answer);
      }
      return { threadId: input.thread.id, answer: 'Went with M05.', messages: [] };
    }),
  };
});

describe('POST /api/threads/:id/ask — the agent asks in a headless turn', () => {
  let dir: string;
  let db: Database.Database;
  let chat: ChatService;
  let threadId: string;
  let pendingInputs: Map<string, PendingInput>;
  let app: express.Express;

  beforeEach(() => {
    turn.answers = [];
    turn.rolesBeforeAnswer = [];
    turn.inputs = [];
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-headless-input-')));
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    chat = new ChatService(db);
    turn.chat = chat;
    threadId = chat.createThread('t', { contextType: 'ask' }).id;
    pendingInputs = new Map();
    const deps = {
      chatService: chat,
      agentCredentialService: { getDecrypted: () => null },
      activeAdapters: new Map<string, ActiveAdapter>(),
      pendingInputs,
      cwd: dir,
      roots: [],
    } as unknown as AgentTurnDeps;
    app = express().use(express.json()).use('/api/threads', threadsRouter(deps));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const ask = () => request(app).post(`/api/threads/${threadId}/ask`).send({ message: 'Which module first?' });

  it('[ac:ac-pytanie-agenta-w-turze-headless-dosta] both the question tool and MCP elicitation get `decline`, written to the thread like in chat', async () => {
    const res = await ask();

    expect(res.status).toBe(200);
    expect(turn.answers.map((a) => (a as UserInputResponse).action)).toEqual(['decline', 'decline']);
    // The question row is written first, the answer row before the agent has it.
    expect(turn.rolesBeforeAnswer[0]).toEqual(['user_input_request', 'user_input_response']);
    const rows = chat.getMessages(threadId);
    expect(rows.map((m) => [m.role, m.toolId])).toEqual([
      ['user_input_request', TOOL_QUESTION.requestId],
      ['user_input_response', TOOL_QUESTION.requestId],
      ['user_input_request', MCP_QUESTION.requestId],
      ['user_input_response', MCP_QUESTION.requestId],
    ]);
    expect(JSON.parse(rows[0]!.content)).toEqual(TOOL_QUESTION);
    expect(JSON.parse(rows[1]!.content).action).toBe('decline');
    expect(JSON.parse(rows[2]!.content)).toEqual(MCP_QUESTION);
    expect(JSON.parse(rows[3]!.content).action).toBe('decline');
  });

  it('[ac:ac-odpowiedz-na-pytanie-agenta-w-turze-h] the answer handed to the agent tells it to act on its own recommendation', async () => {
    await ask();

    expect(HEADLESS_USER_INPUT_GUIDANCE).toMatch(/own recommendation/);
    for (const answer of turn.answers) {
      expect(answer).toEqual({ action: 'decline', message: HEADLESS_USER_INPUT_GUIDANCE });
    }
    // The persisted answer is the one the agent got.
    const responses = chat.getMessages(threadId).filter((m) => m.role === 'user_input_response');
    expect(responses.map((m) => JSON.parse(m.content))).toEqual(turn.answers);
    // The route hands the turn the prompt note that carries the guidance to the
    // model (the adapter's decline has no text field, dev-0508); the real turn's
    // delivery is in agent-turn.headless-guidance.test.ts.
    expect(turn.inputs[0]!.agentPromptNote).toBe(HEADLESS_TURN_PROMPT_NOTE);
  });

  it('[ac:ac-tura-headless-z-pytaniem-agenta-koncz] the turn ends without waiting for a user answer', async () => {
    const res = await ask();

    // The request returned the turn's answer with no `POST /api/chat/user-input` ever sent.
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe('Went with M05.');
    expect(turn.answers).toHaveLength(2);
    // Nothing was parked for a user to answer — so the idle clock never stood on an open question.
    expect(pendingInputs.size).toBe(0);
    // A headless turn: its transagent children are not made interactive by this handler.
    expect(turn.inputs[0]!.headless).toBe(true);
  });
});

/**
 * Job M05 — whoever drives spec work through the agent from outside the app (here:
 * the headless `ask` path `c4s ask` uses) gets the same agent turn, through the
 * API alone: a thread is created by its own request, the turn blocks and returns one
 * answer, and the thread read back carries what happened in the turn — including a
 * question the agent asked and the route's answer to it.
 */
describe('job:M05 — a headless consumer runs an agent turn over the API', () => {
  let dir: string;
  let db: Database.Database;
  let chat: ChatService;
  let app: express.Express;

  beforeEach(() => {
    turn.answers = [];
    turn.rolesBeforeAnswer = [];
    turn.inputs = [];
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-headless-job-')));
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    chat = new ChatService(db);
    turn.chat = chat;
    const deps = {
      chatService: chat,
      agentCredentialService: { getDecrypted: () => null },
      activeAdapters: new Map<string, ActiveAdapter>(),
      pendingInputs: new Map(),
      cwd: dir,
      roots: [],
    } as unknown as AgentTurnDeps;
    app = express().use(express.json()).use('/api/threads', threadsRouter(deps));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('[job:M05] create an ask thread, run one headless turn in which the agent asks, read the thread back', async () => {
    const created = await request(app).post('/api/threads').send({ title: 'ask', context_type: 'ask' });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect(created.body.data.contextType).toBe('ask');

    const asked = await request(app).post(`/api/threads/${id}/ask`).send({ message: 'Which module first?' });
    expect(asked.status).toBe(200);
    expect(asked.body).toMatchObject({ threadId: id, answer: 'Went with M05.' });

    const read = await request(app).get(`/api/threads/${id}`);
    expect(read.status).toBe(200);
    const roles = (read.body.data.messages as { role: string }[]).map((m) => m.role);
    expect(roles).toEqual(['user_input_request', 'user_input_response', 'user_input_request', 'user_input_response']);
    const answers = (read.body.data.messages as { role: string; content: string }[])
      .filter((m) => m.role === 'user_input_response')
      .map((m) => JSON.parse(m.content).action);
    expect(answers).toEqual(['decline', 'decline']);
  });
});
