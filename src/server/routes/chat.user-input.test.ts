import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import type { UserInputRequest, UserInputResponse } from '@inharness-ai/agent-adapters';
import { chatRouter } from './chat.js';
import type { ActiveAdapter, AgentTurnDeps, AgentTurnInput, PendingInput } from './agent-turn.js';
import { ChatService } from '../services/chat.js';
import { runMigrations } from '../db/migrate.js';

/**
 * M05 Agent Runtime `1ia670sq` — the agent's question, server side: the question
 * goes out on the turn stream as `user_input_request`, the answer comes back on
 * its own route (`POST /api/chat/user-input`), and both are written to the
 * thread before the agent gets the answer.
 *
 * The turn itself is a stand-in for the adapter: it asks through the handler
 * `POST /api/chat` hands it (`input.onUserInput`) — the same handler the adapter
 * calls for `AskUserQuestion` — and goes on with whatever answer it receives.
 */
const QUESTION: UserInputRequest = {
  requestId: 'q-1',
  source: 'model-tool',
  origin: 'AskUserQuestion',
  questions: [
    {
      question: 'Which module first?',
      header: 'Module',
      options: [{ label: 'M05' }, { label: 'M53' }],
    },
  ],
} as unknown as UserInputRequest;

const turn = vi.hoisted(() => ({ answers: [] as unknown[] }));

vi.mock('./agent-turn.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./agent-turn.js')>();
  return {
    ...actual,
    runAgentTurn: vi.fn(async (_deps: unknown, input: AgentTurnInput) => {
      input.onEvent({ type: 'text_delta', text: 'Let me ask. ', isSubagent: false } as never);
      const answer = await input.onUserInput!(QUESTION);
      turn.answers.push(answer);
      input.onEvent({ type: 'text_delta', text: `Carrying on after ${answer.action}.`, isSubagent: false } as never);
      input.onEvent({ type: 'result', sessionId: 's1' } as never);
      input.onEvent({ type: 'done' } as never);
      return { threadId: input.thread.id, answer: '', messages: [] };
    }),
  };
});

type Frame = { event: string; data: Record<string, unknown> };

const parseFrames = (body: string): Frame[] => {
  const frames: Frame[] = [];
  let name: string | null = null;
  for (const line of body.split('\n')) {
    if (line.startsWith('event: ')) name = line.slice('event: '.length).trim();
    else if (line.startsWith('data: ') && name) {
      frames.push({ event: name, data: JSON.parse(line.slice('data: '.length)) });
      name = null;
    }
  }
  return frames;
};

describe('POST /api/chat — the agent asks, POST /api/chat/user-input answers', () => {
  let dir: string;
  let db: Database.Database;
  let chat: ChatService;
  let threadId: string;
  let pendingInputs: Map<string, PendingInput>;
  let app: express.Express;

  beforeEach(() => {
    turn.answers = [];
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-user-input-')));
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    chat = new ChatService(db);
    threadId = chat.createThread('t').id;
    pendingInputs = new Map();
    const deps = {
      chatService: chat,
      agentCredentialService: { getDecrypted: () => null },
      activeAdapters: new Map<string, ActiveAdapter>(),
      pendingInputs,
      cwd: dir,
      roots: [],
    } as unknown as AgentTurnDeps;
    app = express().use(express.json()).use('/api/chat', chatRouter(deps));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Start a turn, answer its question with `response` once it is pending, read the whole stream. */
  async function askAndAnswer(response: UserInputResponse) {
    const stream = request(app).post('/api/chat').send({ prompt: 'hi', threadId }).then((r) => r);
    await vi.waitFor(() => expect(pendingInputs.has(QUESTION.requestId)).toBe(true));
    // Written before the agent has any answer.
    const beforeAnswer = chat.getMessages(threadId).map((m) => m.role);
    const answered = await request(app)
      .post('/api/chat/user-input')
      .send({ requestId: QUESTION.requestId, response, threadId });
    const res = await stream;
    return { frames: parseFrames(res.text), answered, beforeAnswer };
  }

  it('[ac:ac-agent-moze-zadac-pytanie-przez-askuse] AskUserQuestion emits a user_input_request event to the client', async () => {
    const { frames } = await askAndAnswer({ action: 'accept', answers: [['M05']] });

    const asked = frames.filter((f) => f.event === 'user_input_request');
    expect(asked).toHaveLength(1);
    expect(asked[0]!.data).toEqual({ type: 'user_input_request', request: QUESTION });
    // On the turn stream, in turn order — after what the agent said before asking.
    const order = frames.map((f) => f.event);
    expect(order.indexOf('user_input_request')).toBeGreaterThan(order.indexOf('text_delta'));
  });

  it('[ac:ac-pytanie-askuserquestion-i-odpowiedz-u] the question and the answer are persisted in chat_message as user_input_request / user_input_response', async () => {
    const response: UserInputResponse = { action: 'accept', answers: [['M53']] };

    const { answered, beforeAnswer } = await askAndAnswer(response);

    expect(answered.status).toBe(200);
    expect(beforeAnswer).toEqual(['user_input_request']);
    const rows = chat.getMessages(threadId);
    expect(rows.map((m) => [m.role, m.toolId])).toEqual([
      ['user_input_request', QUESTION.requestId],
      ['user_input_response', QUESTION.requestId],
    ]);
    expect(JSON.parse(rows[0]!.content)).toEqual(QUESTION);
    expect(JSON.parse(rows[1]!.content)).toEqual(response);
    // The answer reached the agent unchanged.
    expect(turn.answers).toEqual([response]);
  });

  it("[ac:ac-dismiss-karty-user-input-request-pozb] an {action: 'cancel'} answer does not end the turn — the agent goes on with it", async () => {
    const { frames, answered } = await askAndAnswer({ action: 'cancel' });

    expect(answered.status).toBe(200);
    // Delivered to the agent as an answer, not as an abort of the question.
    expect(turn.answers).toEqual([{ action: 'cancel' }]);
    expect(pendingInputs.size).toBe(0);
    // The turn carries on after the cancel and closes normally: no error frame.
    const events = frames.map((f) => f.event);
    expect(events).not.toContain('error');
    const asked = events.indexOf('user_input_request');
    const after = frames.slice(asked + 1);
    expect(after.some((f) => f.event === 'text_delta' && f.data.text === 'Carrying on after cancel.')).toBe(true);
    expect(after.map((f) => f.event).slice(-2)).toEqual(['result', 'done']);
  });
});
