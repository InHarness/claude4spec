import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { chatRouter } from './chat.js';
import type { ActiveAdapter, AgentTurnDeps, AgentTurnInput, PendingInput } from './agent-turn.js';
import { ChatService } from '../services/chat.js';
import { runMigrations } from '../db/migrate.js';
import { defaultRowOf, rowsOfRegistry } from '../services/context-types/registry.js';
import type { ChatContextType } from '../../shared/entities.js';

/**
 * 2.1.88 (M53 `m05seedthr`) — a thread the UI opens without a type (a plain new
 * conversation, a seeded thread: `startSeededThread`, the AC list's "Analyze
 * consistency") is founded server side on the first `POST /api/chat` with no
 * `threadId`, with the PROJECT registry's `Wejście: domyślny` value.
 */
const turn = vi.hoisted(() => ({ threads: [] as Array<{ id: string; contextType: string }> }));

vi.mock('./agent-turn.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./agent-turn.js')>();
  return {
    ...actual,
    runAgentTurn: vi.fn(async (_deps: unknown, input: AgentTurnInput) => {
      turn.threads.push({ id: input.thread.id, contextType: input.thread.contextType });
      input.onEvent({ type: 'result', sessionId: 's1' } as never);
      input.onEvent({ type: 'done' } as never);
      return { threadId: input.thread.id, answer: '', messages: [] };
    }),
  };
});

describe('POST /api/chat without a thread — the registry default (2.1.88)', () => {
  let dir: string;
  let db: Database.Database;
  let chat: ChatService;

  const appWith = (contextTypes?: readonly ChatContextType[]) => {
    const deps = {
      chatService: chat,
      agentCredentialService: { getDecrypted: () => null },
      activeAdapters: new Map<string, ActiveAdapter>(),
      pendingInputs: new Map<string, PendingInput>(),
      cwd: dir,
      roots: [],
      ...(contextTypes ? { contextTypes } : {}),
    } as unknown as AgentTurnDeps;
    return express().use(express.json()).use('/api/chat', chatRouter(deps));
  };

  beforeEach(() => {
    turn.threads = [];
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-default-thread-')));
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    chat = new ChatService(db);
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('[section:m05seedthr] the seeded prompt founds a thread of the project registry\'s `Wejście: domyślny` value, and the turn runs on it', async () => {
    for (const registry of [['chat', 'ask'], ['chat', 'brief', 'patch', 'ask']] as ChatContextType[][]) {
      turn.threads = [];
      const res = await request(appWith(registry)).post('/api/chat').send({ prompt: 'Analyze consistency of all active AC.' });
      expect(res.status, registry.join()).toBe(200);
      expect(turn.threads, registry.join()).toHaveLength(1);
      const founded = chat.getThreadMeta(turn.threads[0]!.id)!;
      const expected = defaultRowOf(rowsOfRegistry(registry)).value;
      expect(founded.contextType, registry.join()).toBe(expected);
      expect(rowsOfRegistry(registry).find((r) => r.value === expected)?.entry).toContain('default');
      expect(turn.threads[0]!.contextType).toBe(expected);
    }
  });
});
