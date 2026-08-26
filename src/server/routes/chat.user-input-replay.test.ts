import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import express from 'express';
import request from 'supertest';
import { chatRouter } from './chat.js';
import {
  cancelPendingForRequest,
  markUserInputResolvedInReplay,
  type ActiveAdapter,
  type AgentTurnDeps,
  type PendingInput,
} from './agent-turn.js';
import type { UserInputRequest, UserInputResponse } from '@inharness-ai/agent-adapters';

/**
 * An answered `AskUserQuestion` used to come BACK as an interactive card after a
 * mid-turn F5 (or a thread switch away and back), cover the composer, and answer
 * `404 no pending input for that requestId` on submit: the adapter yields the
 * question as an ordinary stream event, `emit` buffers it for replay, and
 * nothing ever took it back out once it was answered.
 *
 * These tests pin the two halves of the fix. The resolution sites annotate the
 * buffered event (`resolved: true` + the answer), and the replay route refuses to
 * hand out ANY `user_input_request` whose `pendingInputs` entry is gone — the
 * backstop that also covers a server restart, where the in-memory map is empty
 * but a buffer could still be replayed.
 *
 * Annotated, not deleted, on purpose: a mid-turn joiner restores persisted
 * history only up to before the last user message, so this event is the only
 * trace of the question the running turn's transcript gets. Deleting it would
 * take the read-only history card down with the interactive one.
 */

const THREAD_ID = 't-replay';
const TURN_REQUEST_ID = 'turn-req-1';

const ANSWER: UserInputResponse = {
  action: 'accept',
  answers: { 'Which one?': 'A' },
} as unknown as UserInputResponse;

const makeRequest = (requestId: string): UserInputRequest =>
  ({
    requestId,
    origin: 'AskUserQuestion',
    questions: [{ question: 'Which one?', header: 'Pick', options: [] }],
  }) as unknown as UserInputRequest;

const userInputEvent = (requestId: string) => ({
  type: 'user_input_request',
  request: makeRequest(requestId),
});

function makeActive(events: Array<Record<string, unknown>>): ActiveAdapter {
  return {
    requestId: TURN_REQUEST_ID,
    adapter: { abort: () => {} } as unknown as ActiveAdapter['adapter'],
    emitter: new EventEmitter(),
    replay: {
      turnStart: { type: 'turn_start', prompt: 'hi' },
      events: events as unknown as ActiveAdapter['replay']['events'],
      // 0.2.50 replay byte budget. Test files are excluded from tsc
      // (tsconfig.server.json), so a missing required field here is invisible
      // until something reads it — keep the fixture honest by hand.
      bytes: 0,
    },
    emit: () => {},
  };
}

function makePending(resolved: UserInputResponse[], rejected: unknown[]): PendingInput {
  return {
    resolve: (r) => resolved.push(r),
    reject: (r) => rejected.push(r),
    requestIdsForRequest: TURN_REQUEST_ID,
  };
}

describe('markUserInputResolvedInReplay', () => {
  it('annotates the matching event with the answer and leaves the rest untouched', () => {
    const active = makeActive([
      { type: 'text_delta', text: 'before' },
      userInputEvent('q1'),
      userInputEvent('q2'),
      { type: 'text_delta', text: 'after' },
    ]);
    const activeAdapters = new Map([[THREAD_ID, active]]);

    markUserInputResolvedInReplay(activeAdapters, 'q1', ANSWER);

    const events = active.replay.events as unknown as Array<Record<string, unknown>>;
    expect(events[1]).toMatchObject({ type: 'user_input_request', resolved: true, response: ANSWER });
    // The other question is still live and must stay answerable.
    expect(events[2]!.resolved).toBeUndefined();
    expect(events[0]).toEqual({ type: 'text_delta', text: 'before' });
    expect(events[3]).toEqual({ type: 'text_delta', text: 'after' });
  });

  it('replaces the entry rather than mutating the object already sent on the wire', () => {
    const sentOnTheWire = userInputEvent('q1');
    const active = makeActive([sentOnTheWire]);

    markUserInputResolvedInReplay(new Map([[THREAD_ID, active]]), 'q1', ANSWER);

    expect(sentOnTheWire).not.toHaveProperty('resolved');
    expect(active.replay.events[0]).not.toBe(sentOnTheWire);
  });

  it('is a no-op for an unknown requestId', () => {
    const active = makeActive([userInputEvent('q1')]);

    markUserInputResolvedInReplay(new Map([[THREAD_ID, active]]), 'nope', ANSWER);

    expect((active.replay.events[0] as unknown as Record<string, unknown>).resolved).toBeUndefined();
  });
});

describe('cancelPendingForRequest', () => {
  it('annotates a cancelled request as resolved with a null response', () => {
    const active = makeActive([userInputEvent('q1')]);
    const activeAdapters = new Map([[THREAD_ID, active]]);
    const rejected: unknown[] = [];
    const pendingInputs = new Map<string, PendingInput>([['q1', makePending([], rejected)]]);

    cancelPendingForRequest(pendingInputs, TURN_REQUEST_ID, activeAdapters);

    expect(rejected).toHaveLength(1);
    expect(pendingInputs.size).toBe(0);
    // `response: null` — resolved but unanswerable, so the card renders read-only
    // with its `pending` badge instead of coming back interactive.
    expect(active.replay.events[0]).toMatchObject({ resolved: true, response: null });
  });

  it('still works for callers that pass no adapter map', () => {
    const rejected: unknown[] = [];
    const pendingInputs = new Map<string, PendingInput>([['q1', makePending([], rejected)]]);

    expect(() => cancelPendingForRequest(pendingInputs, TURN_REQUEST_ID)).not.toThrow();
    expect(pendingInputs.size).toBe(0);
  });
});

describe('chat routes — replaying a resolved user_input_request', () => {
  let activeAdapters: Map<string, ActiveAdapter>;
  let pendingInputs: Map<string, PendingInput>;
  let resolved: UserInputResponse[];
  let addedMessages: Array<{ role: string; content: string; toolId: string | null }>;

  beforeEach(() => {
    activeAdapters = new Map();
    pendingInputs = new Map();
    resolved = [];
    addedMessages = [];
  });

  const app = () => {
    const deps = {
      chatService: {
        addMessage: (
          _threadId: string,
          role: string,
          content: string,
          _toolName: string | null,
          toolId: string | null,
        ) => {
          addedMessages.push({ role, content, toolId });
        },
        listQueued: () => [],
        clearQueued: () => [],
        getThreadMeta: () => null,
      },
      activeAdapters,
      pendingInputs,
      cwd: process.cwd(),
      roots: [],
    } as unknown as AgentTurnDeps;
    return express().use(express.json()).use('/chat', chatRouter(deps));
  };

  /** Drive the SSE replay to completion: join, then end the turn so the body settles. */
  const readReplay = async (): Promise<Array<Record<string, unknown>>> => {
    const active = activeAdapters.get(THREAD_ID)!;
    const pending = request(app()).get(`/chat/stream/${THREAD_ID}`);
    const timer = setTimeout(() => active.emitter.emit('event', { type: 'done' }), 25);
    const res = await pending;
    clearTimeout(timer);
    return res.text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>);
  };

  it('POST /user-input annotates the buffer so the next joiner gets no interactive card', async () => {
    activeAdapters.set(THREAD_ID, makeActive([userInputEvent('q1')]));
    pendingInputs.set('q1', makePending(resolved, []));

    const res = await request(app())
      .post('/chat/user-input')
      .send({ requestId: 'q1', response: ANSWER, threadId: THREAD_ID });

    expect(res.status).toBe(200);
    expect(resolved).toEqual([ANSWER]);
    expect(addedMessages).toContainEqual({
      role: 'user_input_response',
      content: JSON.stringify(ANSWER),
      toolId: 'q1',
    });

    const replayed = await readReplay();
    const question = replayed.find((e) => e.type === 'user_input_request');
    expect(question).toMatchObject({ resolved: true, response: ANSWER });
  });

  it('replays a still-answerable question untouched', async () => {
    activeAdapters.set(THREAD_ID, makeActive([userInputEvent('q1')]));
    pendingInputs.set('q1', makePending(resolved, []));

    const replayed = await readReplay();

    const question = replayed.find((e) => e.type === 'user_input_request');
    expect(question).toBeDefined();
    // Nobody has answered it and the handler is still waiting — a joining tab
    // SHOULD get the interactive card here.
    expect(question!.resolved).toBeUndefined();
  });

  it('marks a question with no live pendingInputs entry as resolved (server restart)', async () => {
    // Buffer survived, in-memory map did not: nothing is listening, so the card
    // must arrive read-only rather than dead-but-clickable.
    activeAdapters.set(THREAD_ID, makeActive([userInputEvent('q1')]));

    const replayed = await readReplay();

    const question = replayed.find((e) => e.type === 'user_input_request');
    expect(question).toMatchObject({ resolved: true, response: null });
  });

  it('aborting a turn leaves no answerable question behind in the replay', async () => {
    activeAdapters.set(THREAD_ID, makeActive([userInputEvent('q1'), userInputEvent('q2')]));
    pendingInputs.set('q1', makePending(resolved, []));
    pendingInputs.set('q2', makePending(resolved, []));

    const res = await request(app()).post('/chat/abort').send({ requestId: TURN_REQUEST_ID });

    expect(res.status).toBe(200);
    expect(pendingInputs.size).toBe(0);
    const events = activeAdapters.get(THREAD_ID)!.replay.events as unknown as Array<
      Record<string, unknown>
    >;
    expect(events.every((e) => e.resolved === true && e.response === null)).toBe(true);
  });
});
