import { describe, expect, it, afterEach, vi } from 'vitest';
import { runAgent, AgentError } from './run-agent.js';

/**
 * Reaches `healthCheck` by passing `server` + an unregistered `project` path:
 * `resolveWorkspaceProject` throws, run-agent derives the projectId from the path,
 * then hits `GET <server>/api/projects/<id>/config` — which we stub.
 */
function stubConfigResponse(res: { status: number; ok: boolean; json: () => unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      status: res.status,
      ok: res.ok,
      json: async () => res.json(),
    })),
  );
}

const VALID_CONFIG = {
  name: 'peer',
  roots: [
    {
      id: 'pages',
      name: 'Pages',
      dir: 'pages',
      builtin: true,
      releasable: true,
      sectionIndexed: true,
      referenceValidated: true,
      linkTargets: [],
      sidebar: 'accordion',
      briefTarget: true,
    },
  ],
  entitiesDir: 'entities',
  writingStyle: null,
  onboarding: {},
};

/**
 * Routes the four-step flow (config → create-thread → ask) by URL so a full
 * `runAgent` turn can be exercised. Records every POST body for assertions.
 */
function stubFullFlow(askResponse: Record<string, unknown>): { calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, body });
      if (url.endsWith('/config')) {
        return { status: 200, ok: true, json: async () => VALID_CONFIG };
      }
      if (url.endsWith('/threads')) {
        return { status: 201, ok: true, json: async () => ({ data: { id: 'T1' } }) };
      }
      // POST /threads/T1/ask
      return { status: 200, ok: true, json: async () => askResponse };
    }),
  );
  return { calls };
}

const BASE = { server: 'http://localhost:9999', project: '/tmp/c4s-unregistered-xyz' };

describe('runAgent healthCheck — build-failure surfacing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces PROJECT_BUILD_FAILED with the real message instead of masking it', async () => {
    const message = 'config.json: writingStyle "X" was found on disk but skipped: version 2 > supported 1';
    stubConfigResponse({
      status: 500,
      ok: false,
      json: () => ({ error: { code: 'PROJECT_BUILD_FAILED', message } }),
    });

    const err = await runAgent({ ...BASE, message: 'hi' }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('PROJECT_BUILD_FAILED');
    expect((err as AgentError).message).toBe(message);
  });

  it('still reports SERVER_NOT_RECOGNIZED for a non-c4s error response (no envelope)', async () => {
    stubConfigResponse({ status: 500, ok: false, json: () => ({}) });

    const err = await runAgent({ ...BASE, message: 'hi' }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('SERVER_NOT_RECOGNIZED');
  });
});

describe('runAgent — input validation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects an empty message with INVALID_ARGS before any network call', async () => {
    const err = await runAgent({ ...BASE, message: '   ' }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('INVALID_ARGS');
  });
});

describe('runAgent — ask context + output axis', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates the thread with context_type='ask' and resolves the default model + effort", async () => {
    const { calls } = stubFullFlow({ threadId: 'T1', answer: 'pong' });

    await runAgent({ ...BASE, message: 'ping', contextType: 'ask' });

    const create = calls.find((c) => c.url.endsWith('/threads'));
    expect(create?.body).toEqual({ context_type: 'ask' });
    const ask = calls.find((c) => c.url.endsWith('/T1/ask'));
    expect(ask?.body).toEqual({ message: 'ping', model: 'opus-4.8', effort: 'medium' });
  });

  it('forwards an explicit effort to the run-turn body', async () => {
    const { calls } = stubFullFlow({ threadId: 'T1', answer: 'pong' });

    await runAgent({ ...BASE, message: 'ping', contextType: 'ask', effort: 'high' });

    const ask = calls.find((c) => c.url.endsWith('/T1/ask'));
    expect(ask?.body).toEqual({ message: 'ping', model: 'opus-4.8', effort: 'high' });
  });

  it("output 'full' surfaces messages[]; default 'final' omits them", async () => {
    const msgs = [
      { role: 'user', content: 'ping' },
      { role: 'assistant', content: 'pong' },
    ];
    stubFullFlow({ threadId: 'T1', answer: 'pong', messages: msgs });

    const full = await runAgent({ ...BASE, message: 'ping', contextType: 'ask', output: 'full' });
    expect(full.answer).toBe('pong');
    expect(full.messages).toEqual(msgs);

    const final = await runAgent({ ...BASE, message: 'ping', contextType: 'ask' });
    expect(final.messages).toBeUndefined();
  });
});
