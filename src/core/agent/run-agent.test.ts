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
    expect(ask?.body).toEqual({ message: 'ping', model: 'opus-5.5', effort: 'medium' });
  });

  it('forwards an explicit effort to the run-turn body', async () => {
    const { calls } = stubFullFlow({ threadId: 'T1', answer: 'pong' });

    await runAgent({ ...BASE, message: 'ping', contextType: 'ask', effort: 'high' });

    const ask = calls.find((c) => c.url.endsWith('/T1/ask'));
    expect(ask?.body).toEqual({ message: 'ping', model: 'opus-5.5', effort: 'high' });
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

  it('[ac:ac-predykat-trybu-create-dla-ct-brief-cr] enters create-mode with no create argument at all — the common call', async () => {
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
  ])('[ac:ac-create-mode-ct-brief-source-spoza] rejects %s before any request reaches the server', async (_label, extra) => {
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
  ])('[ac:ac-c4s-agent-ct-brief-w-create-mode-flag] posts %s verbatim', async (_label, params, body) => {
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

describe('runAgent — 2.1.0: --server gives only the address and requires --project <id>', () => {
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

  it('--server without --project → INVALID_ARGS before any request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const err = await runAgent({ server: 'http://localhost:9999', message: 'hi' }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('INVALID_ARGS');
    expect((err as AgentError).hint).toContain('--project <id>');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('--server + --project skips the local registry and addresses /api/projects/<id> on that server', async () => {
    // An id ambiguous in the LOCAL registry is irrelevant: the remote server is
    // the address, and its registry cannot be walked from here.
    const registry = new WorkspaceRegistry(dir);
    registry.registerProject(registry.selectOrCreate({ name: 'ws-a', port: 4521 }), path.join(dir, 'a', 'shared'));
    registry.registerProject(registry.selectOrCreate({ name: 'ws-b', port: 4522 }), path.join(dir, 'b', 'shared'));

    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }));
    const err = await runAgent({ server: 'http://remote.example:7000/', project: 'shared', message: 'hi' }).catch(
      (e) => e,
    );
    expect((err as AgentError).code).toBe('SERVER_NOT_RUNNING');
    expect((err as AgentError).message).toContain('at http://remote.example:7000');
    expect(urls[0]).toBe('http://remote.example:7000/api/projects/shared/config');
  });
});

/**
 * 2.1.53 — the `mcp` channel resolves `project` in the serving workspace: an id
 * present there AND elsewhere addresses the serving workspace's server, with no
 * AMBIGUOUS_*. A local SERVER_NOT_RUNNING names that workspace.
 */
describe('runAgent — 2.1.53: mcp channel resolves in the serving workspace', () => {
  let dir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-run-agent-mcp-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = dir;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('[section:m11dcore] ask over mcp without an explicit workspace consults the peer of the serving workspace', async () => {
    const registry = new WorkspaceRegistry(dir);
    registry.registerProject(registry.selectOrCreate({ name: 'ws-a', port: 4531 }), path.join(dir, 'a', 'shared'));
    registry.registerProject(registry.selectOrCreate({ name: 'ws-b', port: 4532 }), path.join(dir, 'b', 'shared'));

    const { calls } = stubFullFlow({ data: { threadId: 'T1', answer: 'pong' } });
    await runAgent({ project: 'shared', workspace: 'ws-b', channel: 'mcp', contextType: 'ask', message: 'hi' }).catch(() => undefined);
    expect(calls[0]?.url).toBe('http://localhost:4532/api/projects/shared/config');
    expect(calls.every((c) => c.url.startsWith('http://localhost:4532/'))).toBe(true);
  });

  it('[section:m11dcore] SERVER_NOT_RUNNING names the workspace and its local address', async () => {
    const registry = new WorkspaceRegistry(dir);
    registry.registerProject(registry.selectOrCreate({ name: 'ws-a', port: 4533 }), path.join(dir, 'peer'));
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }));
    const err = await runAgent({ project: 'peer', workspace: 'ws-a', channel: 'mcp', message: 'hi' }).catch((e) => e);
    expect((err as AgentError).code).toBe('SERVER_NOT_RUNNING');
    expect((err as AgentError).message).toBe('no claude4spec server for workspace `ws-a` at `http://localhost:4533`');
    expect((err as AgentError).hint).toContain('--server <url>');
  });
});

/**
 * 2.1.26 (M11 `g24dkd8t` / `m11dcore`) — the fifteenth code of the turn family.
 * A `--thread` continuation whose session config differs from the thread's
 * first turn is refused by the peer's run-turn endpoint with HTTP 409
 * `RESUME_CONFIG_LOCKED`; `runAgent` propagates that code (with its message and
 * hint), distinct from the other 409, `STREAM_IN_PROGRESS`.
 */
describe('runAgent — RESUME_CONFIG_LOCKED from the peer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('[section:g24dkd8t] a continuation refused with 409 RESUME_CONFIG_LOCKED surfaces that code, not STREAM_IN_PROGRESS or AGENT_ERROR', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url));
        if (String(url).endsWith('/config')) return { status: 200, ok: true, json: async () => VALID_CONFIG };
        return {
          status: 409,
          ok: false,
          json: async () => ({
            error: {
              code: 'RESUME_CONFIG_LOCKED',
              message: 'architectureConfig.claude_effort differs from the first turn',
              hint: "send the first turn's config or start a new thread",
            },
          }),
        };
      }),
    );

    const err = await runAgent({ ...BASE, message: 'ping', contextType: 'ask', threadId: 'T-old', effort: 'low' }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('RESUME_CONFIG_LOCKED');
    expect((err as AgentError).message).toContain('claude_effort');
    expect((err as AgentError).hint).toContain('new thread');
    // A continuation founds no thread: health-check, then the run-turn call.
    expect(urls.some((u) => u.endsWith('/threads'))).toBe(false);
    expect(urls.at(-1)).toContain('/threads/T-old/ask');
  });
});

/**
 * 2.1.29 (M11) — `planPath` attach: a new chat thread on an existing plan via
 * the generic artifact-attach route (`kind=plan`), then the run-turn on it.
 */
describe('runAgent — plan attach (planPath)', () => {
  afterEach(() => vi.unstubAllGlobals());

  type Reply = { status: number; body: unknown };
  function stubPlanFlow(opts: { attach?: Reply; ask?: Reply } = {}): { calls: Array<{ url: string; body: unknown }> } {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { body?: string }) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
        const reply = (r: Reply) => ({ status: r.status, ok: r.status < 400, json: async () => r.body });
        if (String(url).endsWith('/config')) return reply({ status: 200, body: VALID_CONFIG });
        if (String(url).endsWith('/threads')) {
          return reply(opts.attach ?? { status: 200, body: { data: { threadId: 'T-plan' } } });
        }
        return reply(opts.ask ?? { status: 200, body: { threadId: 'T-plan', answer: 'done' } });
      }),
    );
    return { calls };
  }

  it('[ac:ac-c4s-agent-msg-plan-planpath-zwraca-th] attaches through /artifacts/plan/<planPath>/threads and returns that threadId', async () => {
    const { calls } = stubPlanFlow();
    const result = await runAgent({ ...BASE, message: 'Wykonaj plan', planPath: 'auth-refactor.md' });
    expect(result.threadId).toBe('T-plan');
    const create = calls.find((c) => c.url.endsWith('/threads'));
    expect(create?.url).toMatch(/\/api\/projects\/[^/]+\/artifacts\/plan\/auth-refactor\.md\/threads$/);
    // The attach route takes neither a context nor a planning mode.
    expect(create?.body).toEqual({});
  });

  it('[ac:ac-tura-uruchomiona-przez-c4s-agent-plan] runs the turn in the thread the attach created', async () => {
    const { calls } = stubPlanFlow();
    await runAgent({ ...BASE, message: 'Wykonaj plan', planPath: 'auth-refactor.md' });
    const ask = calls.find((c) => c.url.endsWith('/ask'));
    expect(ask?.url).toMatch(/\/threads\/T-plan\/ask$/);
    expect((ask?.body as { message: string }).message).toBe('Wykonaj plan');
  });

  it('[ac:ac-plan-z-przedrostkiem-claude4spec-plan] strips a leading .claude4spec/plans/ — both spellings attach the same plan', async () => {
    const urls: string[] = [];
    for (const planPath of ['nested/auth-refactor.md', '.claude4spec/plans/nested/auth-refactor.md']) {
      const { calls } = stubPlanFlow();
      await runAgent({ ...BASE, message: 'go', planPath });
      urls.push(calls.find((c) => c.url.endsWith('/threads'))!.url);
      vi.unstubAllGlobals();
    }
    expect(urls[0]).toMatch(/\/artifacts\/plan\/nested\/auth-refactor\.md\/threads$/);
    expect(urls[1]).toBe(urls[0]);
  });

  it.each([
    ['ac-plan-razem-z-thread-konczy-sie-invali', { threadId: 'T-old' }],
    ['ac-plan-razem-z-brief-konczy-sie-invalid', { briefPath: 'b.md' }],
    ['ac-plan-razem-z-ct-innym-niz-chat-konczy', { contextType: 'brief' as const }],
    ['ac-plan-razem-z-ct-innym-niz-chat-konczy', { contextType: 'ask' as const }],
  ])('[ac:%s] rejects planPath with %o locally — INVALID_ARGS, no request', async (_slug, extra) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const err = await runAgent({ ...BASE, message: 'go', planPath: 'p.md', ...extra }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('INVALID_ARGS');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts contextType chat together with planPath', async () => {
    const { calls } = stubPlanFlow();
    await runAgent({ ...BASE, message: 'go', planPath: 'p.md', contextType: 'chat' });
    expect(calls.some((c) => /\/artifacts\/plan\/p\.md\/threads$/.test(c.url))).toBe(true);
  });

  it('refuses a traversing planPath before any thread call', async () => {
    const { calls } = stubPlanFlow();
    const err = await runAgent({ ...BASE, message: 'go', planPath: '../outside.md' }).catch((e) => e);
    expect((err as AgentError).code).toBe('INVALID_ARGS');
    expect(calls.some((c) => c.url.endsWith('/threads'))).toBe(false);
  });

  it('[ac:ac-plan-ze-sciezka-nieistniejacego-planu] a 404 PLAN_NOT_FOUND from the attach route surfaces as NOT_FOUND, no turn', async () => {
    const { calls } = stubPlanFlow({
      attach: {
        status: 404,
        body: { error: { code: 'PLAN_NOT_FOUND', message: "plan 'nope.md' not found", hint: 'plans: a.md' } },
      },
    });
    const err = await runAgent({ ...BASE, message: 'go', planPath: 'nope.md' }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('NOT_FOUND');
    expect((err as AgentError).message).toContain('nope.md');
    expect((err as AgentError).hint).toBe('plans: a.md');
    expect(calls.some((c) => c.url.endsWith('/ask'))).toBe(false);
  });

  it('[ac:ac-blad-run-turn-po-dowiazaniu-watku-prz] a run-turn failure after the attach carries the created threadId and a --thread resume hint', async () => {
    stubPlanFlow({
      ask: { status: 409, body: { error: { code: 'STREAM_IN_PROGRESS', message: 'a turn is already streaming' } } },
    });
    const err = await runAgent({ ...BASE, message: 'go', planPath: 'p.md' }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('STREAM_IN_PROGRESS');
    expect((err as AgentError).details).toEqual({ threadId: 'T-plan' });
    expect((err as AgentError).hint).toContain('--thread T-plan');
  });
});
