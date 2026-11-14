import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { createAdapter } from '@inharness-ai/agent-adapters';
import { threadsRouter } from './threads.js';
import type { AgentTurnDeps } from './agent-turn.js';
import type { ChatThreadMeta } from '../../shared/entities.js';

/**
 * M05 2.1.66 (`v46i6w3l`, `agcrdinj`) — where a turn's model secret comes from.
 *
 * The adapter runs the CLI that `@anthropic-ai/claude-agent-sdk` ships (a dependency of
 * this package — no separately installed `claude` on PATH), and the SDK process inherits
 * the server's environment. Sources, in order: the key saved in settings (injected per
 * turn into `custom_env`), then `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` from the
 * server process env, then the local login. The server neither reads, writes nor logs
 * those env variables — it only stays out of the way.
 *
 * The chain is exercised for real past the server: the route composes the turn's
 * `architectureConfig` (captured from `runAgentTurn`), the REAL claude-code adapter
 * spawns the REAL bundled CLI with that config, and a local fake Anthropic API
 * (`ANTHROPIC_BASE_URL`) records which credential arrived. PATH is narrowed to system
 * dirs so a locally installed `claude` cannot be what answers.
 */
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

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'PATH',
] as const;

const thread: ChatThreadMeta = {
  id: 't-env-auth',
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
};

interface SeenRequest {
  apiKey: string | undefined;
  authorization: string | undefined;
}

describe('M05 — the turn authenticates from the server process env when no key is saved', () => {
  let dir: string;
  let savedEnv: Record<string, string | undefined>;
  let fakeApi: http.Server;
  let seen: SeenRequest[];
  let onMessages: (() => void) | null;

  beforeEach(async () => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-env-auth-')));
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    seen = [];
    onMessages = null;
    runAgentTurnMock.mockClear();
    // A fake Anthropic API: records the credential of every Messages call and refuses it,
    // so the CLI never gets a real answer and the network is never touched.
    fakeApi = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        if (req.url?.startsWith('/v1/messages')) {
          seen.push({
            apiKey: req.headers['x-api-key'] as string | undefined,
            authorization: req.headers.authorization,
          });
          onMessages?.();
        }
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'fake' } }));
      });
    });
    await new Promise<void>((resolve) => fakeApi.listen(0, '127.0.0.1', resolve));
    const { port } = fakeApi.address() as AddressInfo;

    for (const k of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN'] as const) {
      delete process.env[k];
    }
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
    // An empty config dir: no local login can stand in for the env secret.
    process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'claude-config');
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
    process.env.PATH = '/usr/bin:/bin';
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await new Promise<void>((resolve) => fakeApi.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const app = (savedKey: string | null) => {
    const deps = {
      chatService: {
        getThreadMeta: (id: string) => (id === thread.id ? thread : null),
        getInitialArchitectureConfig: () => null,
        isConsultationThread: () => false,
      },
      agentCredentialService: { getDecrypted: () => (savedKey ? { apiKey: savedKey } : null) },
      activeAdapters: new Map(),
      cwd: dir,
      roots: [],
    } as unknown as AgentTurnDeps;
    return express().use(express.json()).use('/threads', threadsRouter(deps));
  };

  /** Compose the turn through the route, then run it on the real adapter until the first Messages call. */
  const runTurn = async (savedKey: string | null): Promise<SeenRequest> => {
    const res = await request(app(savedKey))
      .post(`/threads/${thread.id}/ask`)
      .send({ message: 'hi', model: 'haiku-4.5' });
    expect(res.status).toBe(200);
    const architectureConfig = runAgentTurnMock.mock.calls.at(-1)![1].architectureConfig;

    const adapter = createAdapter('claude-code');
    const firstCall = new Promise<void>((resolve) => {
      onMessages = () => {
        adapter.abort();
        resolve();
      };
    });
    const events: string[] = [];
    const drain = (async () => {
      for await (const e of adapter.execute({
        prompt: 'hi',
        model: 'haiku-4.5',
        architectureConfig,
        cwd: dir,
        maxTurns: 1,
      })) {
        events.push(e.type);
      }
    })().catch(() => {});
    await Promise.race([firstCall, drain]);
    adapter.abort();
    await drain;
    expect(seen.length, `no Messages call reached the fake API; events: ${events.join(', ')}`).toBeGreaterThan(0);
    return seen[0];
  };

  it('[ac:ac-tura-bez-klucza-w-ustawieniach-i-z-an] without a saved key and with ANTHROPIC_API_KEY in the server env, the turn authenticates with that key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-from-server-env-1234';

    const call = await runTurn(null);

    // The server injected nothing: no saved key ⇒ no `custom_env` override of the env key.
    const architectureConfig = runAgentTurnMock.mock.calls.at(-1)![1].architectureConfig;
    expect((architectureConfig.custom_env as Record<string, unknown> | undefined)?.ANTHROPIC_API_KEY).toBeUndefined();
    // …and the bundled CLI, inheriting the server env, sent exactly that key.
    expect(call.apiKey).toBe('sk-ant-from-server-env-1234');
    expect(call.authorization).toBeUndefined();
  }, 60_000);

  it('a key saved in settings takes precedence over ANTHROPIC_API_KEY in the server env', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-from-server-env-1234';

    const call = await runTurn('sk-ant-saved-in-settings-5678');

    expect(call.apiKey).toBe('sk-ant-saved-in-settings-5678');
    // The per-turn injection leaves the server process env untouched.
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-from-server-env-1234');
  }, 60_000);

  it('the server source never reads or writes the env model secrets itself', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const offenders: string[] = [];
    const walk = (p: string) => {
      for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
        const full = path.join(p, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const src = fs.readFileSync(full, 'utf8');
          if (/process\.env(\.|\[\s*['"])(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)/.test(src)) offenders.push(full);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
