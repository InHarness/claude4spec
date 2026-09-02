import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAgent, AgentError } from './run-agent.js';
import { WorkspaceRegistry } from '../../server/workspace/registry.js';

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

describe('runAgent — run-turn fetch failure classification', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('surfaces SERVER_NOT_RUNNING when the run-turn call is refused (ECONNREFUSED)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/config')) {
          return { status: 200, ok: true, json: async () => VALID_CONFIG };
        }
        if (url.endsWith('/threads')) {
          return { status: 201, ok: true, json: async () => ({ data: { id: 'T1' } }) };
        }
        // POST /threads/T1/ask — genuine connection refusal.
        const err = new Error('fetch failed');
        (err as unknown as { cause: { code: string } }).cause = { code: 'ECONNREFUSED' };
        throw err;
      }),
    );

    const err = await runAgent({ ...BASE, message: 'ping', contextType: 'ask' }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('SERVER_NOT_RUNNING');
  });

  it('does NOT report SERVER_NOT_RUNNING for a run-turn client-side timeout — the turn may have completed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/config')) {
          return { status: 200, ok: true, json: async () => VALID_CONFIG };
        }
        if (url.endsWith('/threads')) {
          return { status: 201, ok: true, json: async () => ({ data: { id: 'T1' } }) };
        }
        // POST /threads/T1/ask — undici headers/body timeout, NOT a dead server.
        const err = new Error('fetch failed');
        (err as unknown as { cause: { code: string } }).cause = { code: 'UND_ERR_HEADERS_TIMEOUT' };
        throw err;
      }),
    );

    const err = await runAgent({ ...BASE, message: 'ping', contextType: 'ask' }).catch((e) => e);
    expect(err).not.toBeInstanceOf(AgentError);
    expect((err as Error).message).toBe('fetch failed');
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
    expect(ask?.body).toEqual({ message: 'ping', model: 'opus-5', effort: 'medium' });
  });

  it('forwards an explicit effort to the run-turn body', async () => {
    const { calls } = stubFullFlow({ threadId: 'T1', answer: 'pong' });

    await runAgent({ ...BASE, message: 'ping', contextType: 'ask', effort: 'high' });

    const ask = calls.find((c) => c.url.endsWith('/T1/ask'));
    expect(ask?.body).toEqual({ message: 'ping', model: 'opus-5', effort: 'high' });
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

/**
 * Stub dla obu drog create-thread na briefie. `POST /api/briefs` odpowiada
 * pelnym `BriefResponse` (m.in. `threads[]`), a nie osobnym polem na id watku.
 */
function stubBriefFlow(opts: { threads?: Array<{ id: string }>; briefPath?: string } = {}) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const threads = opts.threads ?? [{ id: 'T1' }];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, body });
      if (url.endsWith('/config')) {
        return { status: 200, ok: true, json: async () => VALID_CONFIG };
      }
      if (url.endsWith('/briefs')) {
        return {
          status: 201,
          ok: true,
          json: async () => ({
            data: {
              path: opts.briefPath ?? 'analysis-brief.md',
              frontmatter: {},
              body: '',
              content: '',
              hash: 'h1',
              threads,
            },
          }),
        };
      }
      if (url.endsWith('/threads')) {
        return { status: 201, ok: true, json: async () => ({ data: { threadId: 'T1' } }) };
      }
      return { status: 200, ok: true, json: async () => ({ threadId: 'T1', answer: 'done' }) };
    }),
  );
  return { calls };
}

/**
 * 0.2.64 — the mode predicate has ONE condition: `briefPath` present → attach,
 * absent → create. There is no mutex left to enforce, so `briefPath` next to a
 * window argument is just a contradiction in the arguments.
 */
describe('runAgent — brief mode predicate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('enters create-mode with no create argument at all — the common call', async () => {
    const { calls } = stubBriefFlow();
    await runAgent({ ...BASE, message: 'hi', contextType: 'brief' });

    expect(calls.find((c) => c.url.endsWith('/briefs'))?.body).toEqual({ toReleaseName: null });
  });

  /**
   * Walidacja argumentow biegnie PRZED `resolveServer`/`healthCheck`. Inaczej
   * sprzecznosc flag konczy sie przy zgaszonym serwerze jako
   * `SERVER_NOT_RUNNING` — diagnoza zupelnie innego problemu. Dowod: ani jeden
   * fetch nie wychodzi.
   */
  it.each([
    ['briefPath with a window end', { briefPath: 'a.md', toReleaseName: '0.2.0' }],
    ['briefPath with roots', { briefPath: 'a.md', roots: ['app'] }],
    ['briefPath with a suffix', { briefPath: 'a.md', suffix: 's' }],
    ['roots with no toReleaseName', { fromReleaseName: '0.1.0', roots: ['app'] }],
  ])('rejects %s before any request reaches the server', async (_label, extra) => {
    const { calls } = stubBriefFlow();
    const err = await runAgent({ ...BASE, message: 'hi', contextType: 'brief', ...extra }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('INVALID_ARGS');
    expect(calls).toEqual([]);
  });
});

/**
 * The whole mapping, one row per window shape. `to` is the discriminator, and
 * the difference between an OMITTED `fromReleaseName` and an explicit `null`
 * one is load-bearing: omitted means "the latest release" (resolved by the
 * server), null means "from the beginning".
 */
describe('runAgent — brief create-mode window mapping', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [
      'a closed window',
      { fromReleaseName: '0.1.0', toReleaseName: '0.2.0', roots: ['app'] },
      { fromReleaseName: '0.1.0', toReleaseName: '0.2.0', roots: ['app'] },
    ],
    ['a window open at the start', { toReleaseName: '0.1.0' }, { fromReleaseName: null, toReleaseName: '0.1.0' }],
    ['a window open to the current state', { fromReleaseName: '0.2.0' }, { fromReleaseName: '0.2.0', toReleaseName: null }],
    ['no window at all', { suffix: 's' }, { toReleaseName: null, suffix: 's' }],
  ])('posts %s verbatim', async (_label, params, body) => {
    const { calls } = stubBriefFlow();
    await runAgent({ ...BASE, message: 'go', contextType: 'brief', ...params });

    expect(calls.find((c) => c.url.endsWith('/briefs'))?.body).toEqual(body);
  });
});

describe('runAgent — brief create-mode', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('takes threadId from BriefResponse.threads[0].id and surfaces the minted path', async () => {
    const { calls } = stubBriefFlow({ threads: [{ id: 'T-initial' }], briefPath: 'analysis-brief.md' });

    const result = await runAgent({
      ...BASE,
      message: 'Code drift on X',
      contextType: 'brief',
    });

    expect(result.briefPath).toBe('analysis-brief.md');
    // Tura leci na watku z threads[0], nie na czymkolwiek innym z odpowiedzi.
    expect(calls.some((c) => c.url.endsWith('/threads/T-initial/ask'))).toBe(true);
  });

  /** Pusta `threads[]` znaczy, ze plik powstal bez watku — tury nie ma na czym postawic. */
  it('fails with AGENT_ERROR when the response carries no initial thread', async () => {
    stubBriefFlow({ threads: [] });

    const err = await runAgent({
      ...BASE,
      message: 'go',
      contextType: 'brief',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('AGENT_ERROR');
  });

  it('omits briefPath for attach-mode (existing brief, no mint)', async () => {
    const { calls } = stubBriefFlow();

    const result = await runAgent({
      ...BASE,
      message: 'follow up',
      contextType: 'brief',
      briefPath: 'existing-brief.md',
    });

    expect(result.briefPath).toBeUndefined();
    /**
     * Pelny URL, nie `endsWith('/threads')`: watki briefu przeniosly sie do
     * generycznej rodziny M36, a `runAgent` przez dwa wydania walil w martwe
     * `/briefs/<path>/threads` — luzny matcher tego nie zlapal.
     */
    const create = calls.find((c) => c.url.endsWith('/threads'));
    expect(create?.url).toMatch(/\/artifacts\/brief\/existing-brief\.md\/threads$/);
  });

  it('refuses a traversing briefPath before any thread call', async () => {
    stubBriefFlow();
    const err = await runAgent({
      ...BASE,
      message: 'hi',
      contextType: 'brief',
      briefPath: '../outside.md',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('INVALID_ARGS');
  });
});

describe('runAgent — --server branch surfaces real ambiguity instead of hashing the slug', () => {
  let dir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-run-agent-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = dir;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('throws AgentError(AMBIGUOUS_PROJECT) instead of silently hashing the slug as a path', async () => {
    const registry = new WorkspaceRegistry(dir);
    const wsA = registry.selectOrCreate({ name: 'ws-a', port: 4521 });
    const wsB = registry.selectOrCreate({ name: 'ws-b', port: 4522 });
    registry.registerProject(wsA, path.join(dir, 'repo-a', 'shared-name'));
    registry.registerProject(wsB, path.join(dir, 'repo-b', 'shared-name'));

    // No fetch stub: a fix regression here would previously hash the slug and
    // proceed to a network call — asserting rejection means it never reaches fetch.
    const err = await runAgent({
      server: 'http://localhost:9999',
      project: 'shared-name',
      message: 'hi',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('AMBIGUOUS_PROJECT');
  });
});
