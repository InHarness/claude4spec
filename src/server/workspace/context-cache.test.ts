import { afterEach, describe, expect, it, vi } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  FAILED_BUILD_WINDOW_MS,
  ProjectBuildFailedError,
  ProjectContextCache,
  type ProjectBuildStateChange,
} from './context-cache.js';
import { projectDispatchMiddleware } from './middleware.js';
import { listProjects } from './list-projects.js';
import { buildWorkspaceToolsServer } from '../mcp/workspace-tools.js';
import type { BackgroundBuildResult } from './bootstrap.js';
import type { ProjectContext } from './project-context.js';
import type { WorkspaceRegistry } from './registry.js';
import type { ProjectRecord, WorkspaceRecord } from './types.js';

/**
 * 2.1.60 — M31 `m31ctx001` / `ssn335r8` / `l4txpfx0`: the background build
 * queue, the five build states and their signal, the failed-build window, and
 * the request that waits for a build. The builds are doubles held open until
 * the test lets them finish, so the order of the queue is read off the order in
 * which they START. The failed-build window runs on an injected clock.
 */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets the queue react: resolved builds settle and the next one starts (after every microtask). */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Turns the event loop until an HTTP request has reached the cache (`cache.get` was called). */
async function untilRequested(spy: { mock: { calls: unknown[] } }, calls = 1): Promise<void> {
  while (spy.mock.calls.length < calls) await flush();
}

function fakeCtx(id: string, inFlight = () => false): ProjectContext {
  const router = Router();
  router.get('/ping', (_req, res) => {
    res.json({ project: id });
  });
  return { projectId: id, router, hasInFlightTurn: inFlight, dispose: vi.fn(async () => {}) } as unknown as ProjectContext;
}

const record = (id: string): ProjectRecord => ({ id, cwd: `/projects/${id}`, addedAt: '2026-10-28T00:00:00.000Z' });

/** The cache with background builds held open per project; activations (the build with writes) resolve at once. */
function harness() {
  let now = 0;
  const started: string[] = [];
  const open = new Map<string, Deferred<BackgroundBuildResult<ProjectContext>>>();
  const activated: string[] = [];
  const changes: ProjectBuildStateChange[] = [];
  const cache = new ProjectContextCache(
    async (p) => {
      activated.push(p.id);
      return fakeCtx(p.id);
    },
    {
      background: (p, signal) => {
        started.push(p.id);
        const d = deferred<BackgroundBuildResult<ProjectContext>>();
        open.set(p.id, d);
        // Like the real build: the shutdown (`disposeAll` in afterEach) aborts a build still open.
        signal.addEventListener('abort', () => d.reject(signal.reason as Error));
        return d.promise;
      },
      now: () => now,
    },
  );
  cache.onStateChange((c) => changes.push(c));
  caches.push(cache);
  /** The background build of `id` (the one started last) ends ready; returns the context it built. */
  const finish = async (id: string) => {
    const context = fakeCtx(id);
    open.get(id)!.resolve({ state: 'ready', context });
    await flush();
    return context;
  };
  const fail = async (id: string, cause: string) => {
    open.get(id)!.reject(new Error(cause));
    await flush();
  };
  const needsActivation = async (id: string) => {
    open.get(id)!.resolve({ state: 'needs-activation', needs: ['config-missing'] });
    await flush();
  };
  return {
    cache,
    started,
    activated,
    changes,
    finish,
    fail,
    needsActivation,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** The dispatch middleware over a stub registry holding `projects`. */
function appOver(cache: ProjectContextCache, projects: ProjectRecord[]) {
  const ws = { name: 'default', mode: 'prod', defaultPort: 4500, projects } as unknown as WorkspaceRecord;
  const registry = {
    getProject: (_ws: WorkspaceRecord, id: string) => projects.find((p) => p.id === id) ?? null,
    getWorkspace: () => ws,
  } as unknown as WorkspaceRegistry;
  return express().use('/api/projects/:id', projectDispatchMiddleware(registry, ws, cache));
}

const caches: ProjectContextCache[] = [];
afterEach(async () => {
  for (const cache of caches.splice(0)) await cache.disposeAll();
});

describe('M31 — the background build queue (2.1.60)', () => {
  it('[ac:ac-konteksty-projektow-buduja-sie-w-tle] the contexts of the projects build in the background, one at a time: the next starts only when the current one is ready', async () => {
    const h = harness();
    h.cache.start(['a', 'b', 'c'].map(record));
    await flush();
    // No request was made, yet the first build runs — and only the first.
    expect(h.started).toEqual(['a']);
    await h.finish('a');
    expect(h.started).toEqual(['a', 'b']);
    await h.finish('b');
    expect(h.started).toEqual(['a', 'b', 'c']);
    await h.finish('c');
    expect(['a', 'b', 'c'].map((id) => h.cache.getLive(id)?.projectId)).toEqual(['a', 'b', 'c']);
    // Never two builds at once: every `building` is followed by its outcome before the next `building`.
    const building = h.changes.filter((c) => c.state !== 'queued').map((c) => `${c.projectId}:${c.state}`);
    expect(building).toEqual(['a:building', 'a:ready', 'b:building', 'b:ready', 'c:building', 'c:ready']);
  });

  it('[ac:ac-budowa-w-tle-zaczyna-sie-od-ostatnio] the background build starts from the last opened project of the workspace, then follows the composition order', async () => {
    const h = harness();
    h.cache.start(['a', 'b', 'c', 'd'].map(record), 'c');
    await flush();
    for (const id of ['c', 'a', 'b']) await h.finish(id);
    expect(h.started).toEqual(['c', 'a', 'b', 'd']);

    // Without a last opened project — or one no longer in the workspace — the composition order.
    const plain = harness();
    plain.cache.start(['a', 'b'].map(record));
    await flush();
    await plain.finish('a');
    expect(plain.started).toEqual(['a', 'b']);
    const gone = harness();
    gone.cache.start(['a', 'b'].map(record), 'detached');
    await flush();
    await gone.finish('a');
    expect(gone.started).toEqual(['a', 'b']);
  });

  it('[ac:ac-kazda-zmiana-stanu-budowy-projektu-em] [section:ssn335r8] every change of a project\'s build state emits a signal with the project id and the new state (and the cause of a failure)', async () => {
    const h = harness();
    h.cache.start(['a', 'b', 'c'].map(record));
    await flush();
    await h.finish('a');
    await h.fail('b', 'config.json: invalid JSON');
    await h.needsActivation('c');
    expect(h.changes).toEqual([
      { projectId: 'a', state: 'queued' },
      { projectId: 'a', state: 'building' },
      { projectId: 'b', state: 'queued' },
      { projectId: 'c', state: 'queued' },
      { projectId: 'a', state: 'ready' },
      { projectId: 'b', state: 'building' },
      { projectId: 'b', state: 'failed', cause: 'config.json: invalid JSON' },
      { projectId: 'c', state: 'building' },
      { projectId: 'c', state: 'needs-activation' },
    ]);
    // Every transition is one signal: the state each project ends in is its last signal.
    expect(h.cache.readStates()).toEqual(
      new Map([
        ['a', 'ready'],
        ['b', 'failed'],
        ['c', 'needs-activation'],
      ]),
    );
  });

  it('[ac:ac-nieudana-budowa-jednego-projektu-nie] a failed build of one project does not stop the background build of the others', async () => {
    const h = harness();
    h.cache.start(['a', 'b', 'c'].map(record));
    await flush();
    await h.fail('a', 'boom');
    expect(h.started).toEqual(['a', 'b']);
    await h.finish('b');
    await h.finish('c');
    expect(h.cache.getLive('b')).not.toBeNull();
    expect(h.cache.getLive('c')).not.toBeNull();
    expect(h.cache.readStates().get('a')).toBe('failed');
  });

  it('[ac:ac-zadanie-do-projektu-czekajacego-w-kol] a request to a project waiting in the queue moves it to the front: it builds right after the current build', async () => {
    const h = harness();
    const projects = ['a', 'b', 'c', 'd'].map(record);
    h.cache.start(projects);
    await flush();
    const waiting = h.cache.get(projects[3]!);
    // The current build is not interrupted…
    expect(h.started).toEqual(['a']);
    await h.finish('a');
    // …and the requested project goes next, ahead of b and c.
    expect(h.started).toEqual(['a', 'd']);
    await h.finish('d');
    await waiting;
    await h.finish('b');
    expect(h.started).toEqual(['a', 'd', 'b', 'c']);
  });

  it('[ac:ac-zadanie-do-projektu-czekajacego-w-kol-2] a request to a project waiting in the queue gets its answer once that project\'s build ends — not an error', async () => {
    const h = harness();
    const projects = ['a', 'b'].map(record);
    h.cache.start(projects);
    await flush();
    const app = appOver(h.cache, projects);
    const get = vi.spyOn(h.cache, 'get');
    let answered = false;
    const pending = request(app)
      .get('/api/projects/b/ping')
      .then((res) => {
        answered = true;
        return res;
      });
    await untilRequested(get);
    await h.finish('a');
    // b is building now; the request waits for it.
    expect(h.started).toEqual(['a', 'b']);
    await flush();
    expect(answered).toBe(false);
    await h.finish('b');
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ project: 'b' });
  });

  it('[ac:ac-w-trakcie-budowy-w-tle-zadanie-do-pro] during a background build a request to a ready project is served without waiting for that build to end', async () => {
    const h = harness();
    const projects = ['a', 'b'].map(record);
    h.cache.start(projects);
    await flush();
    await h.finish('a');
    expect(h.started).toEqual(['a', 'b']); // b is building and stays open
    const res = await request(appOver(h.cache, projects)).get('/api/projects/a/ping');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ project: 'a' });
    // b's build has still not ended.
    expect(h.cache.readStates().get('b')).toBe('building');
  });

  it('[ac:ac-po-zakonczeniu-budowy-w-tle-zadanie-d] after the background build, a request to any project of the composition whose build succeeded does not wait for a context build', async () => {
    const h = harness();
    const projects = ['a', 'b', 'c'].map(record);
    h.cache.start(projects);
    await flush();
    for (const id of ['a', 'b', 'c']) await h.finish(id);
    const startedBefore = [...h.started];
    for (const p of projects) {
      // The context is there already: the answer is the built context, no build starts.
      expect((await h.cache.get(p)).projectId).toBe(p.id);
    }
    expect(h.started).toEqual(startedBefore);
    expect(h.activated).toEqual([]);
    const res = await request(appOver(h.cache, projects)).get('/api/projects/c/ping');
    expect(res.body).toEqual({ project: 'c' });
  });

  it('[ac:ac-po-zakonczeniu-budowy-w-tle-otwarcie] after the background build, opening tabs of 10 different projects of the workspace builds no context', async () => {
    const h = harness();
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const projects = ids.map(record);
    h.cache.start(projects);
    await flush();
    for (const id of ids) await h.finish(id);
    expect(h.started).toEqual(ids);

    const app = appOver(h.cache, projects);
    const responses = await Promise.all(ids.map((id) => request(app).get(`/api/projects/${id}/ping`)));
    expect(responses.map((r) => r.body.project)).toEqual(ids);
    // Ten tabs, no build of any kind — and all ten contexts stay live (no limit, no eviction).
    expect(h.started).toEqual(ids);
    expect(h.activated).toEqual([]);
    expect(ids.every((id) => h.cache.getLive(id) !== null)).toBe(true);
  });

  it('[ac:ac-projekt-zarejestrowany-po-starcie-pro] a project registered after the start builds in the background without a request', async () => {
    const h = harness();
    h.cache.start([record('a')]);
    await flush();
    await h.finish('a');
    h.cache.enqueue(record('late'));
    await flush();
    expect(h.started).toEqual(['a', 'late']);
    await h.finish('late');
    expect(h.cache.getLive('late')?.projectId).toBe('late');
  });

  it('[ac:ac-odpowiedz-project-build-failed-niesie] the PROJECT_BUILD_FAILED answer carries the cause of the failed build in its message — within the ~15 s window, without a new attempt', async () => {
    const h = harness();
    const projects = [record('broken')];
    h.cache.start(projects);
    await flush();
    await h.fail('broken', "config.json: field 'entities' expected string[], got string");
    const app = appOver(h.cache, projects);
    const res = await request(app).get('/api/projects/broken/ping');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'PROJECT_BUILD_FAILED', message: "config.json: field 'entities' expected string[], got string" },
    });
    // Within the window: the same answer, no new build.
    h.advance(FAILED_BUILD_WINDOW_MS - 1);
    await expect(h.cache.get(projects[0]!)).rejects.toBeInstanceOf(ProjectBuildFailedError);
    expect(h.started).toEqual(['broken']);
    // After it, a request starts the next try — and waits for it.
    h.advance(1);
    const get = vi.spyOn(h.cache, 'get');
    const retry = request(app)
      .get('/api/projects/broken/ping')
      .then((r) => r);
    await untilRequested(get);
    expect(h.started).toEqual(['broken', 'broken']);
    await h.finish('broken');
    expect((await retry).status).toBe(200);
  });

  it('[section:7yzu5k8u] a build stopped by an unresolvable writing style answers every request with PROJECT_BUILD_FAILED, and after the window retries — and fails again — at the first request or at a read of the workspace\'s project states', async () => {
    const h = harness();
    const projects = [record('styled')];
    const cause = "writing style 'house-style' cannot be resolved — no selectable style has this slug";
    h.cache.start(projects);
    await flush();
    await h.fail('styled', cause);
    const app = appOver(h.cache, projects);
    // Every request — the settings routes included — gets the failure with its cause.
    for (const route of ['/api/projects/styled/ping', '/api/projects/styled/config']) {
      const res = await request(app).get(route);
      expect(res.status).toBe(500);
      expect(res.body.error).toEqual({ code: 'PROJECT_BUILD_FAILED', message: cause });
    }
    expect(h.started).toEqual(['styled']);
    // After the window, a read of the project states retries…
    h.advance(FAILED_BUILD_WINDOW_MS);
    h.cache.readStates();
    await flush();
    expect(h.started).toEqual(['styled', 'styled']);
    await h.fail('styled', cause);
    // …and so does the first request after the next window — failing again while the style stays unresolvable.
    h.advance(FAILED_BUILD_WINDOW_MS);
    const get = vi.spyOn(h.cache, 'get');
    const retry = request(app)
      .get('/api/projects/styled/ping')
      .then((r) => r);
    await untilRequested(get);
    expect(h.started).toEqual(['styled', 'styled', 'styled']);
    await h.fail('styled', cause);
    const res = await retry;
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe(cause);
  });

  it('[ac:ac-odczyt-stanu-projektow-workspace-u-ni] a read of the workspace\'s project states does not change the order of the build queue', async () => {
    const h = harness();
    h.cache.start(['a', 'b', 'c', 'd'].map(record));
    await flush();
    // Reads while the queue is full — each one returns the states, none reorders.
    expect(h.cache.readStates()).toEqual(
      new Map([
        ['a', 'building'],
        ['b', 'queued'],
        ['c', 'queued'],
        ['d', 'queued'],
      ]),
    );
    for (const id of ['a', 'b', 'c']) {
      h.cache.readStates();
      await h.finish(id);
    }
    expect(h.started).toEqual(['a', 'b', 'c', 'd']);
  });

  it('[ac:ac-odczyt-stanu-projektow-workspace-u-po] [section:ssn335r8] a read of the workspace\'s project states after the failed-build window puts the failed project back in the queue — at its end', async () => {
    const h = harness();
    h.cache.start(['a', 'b', 'c'].map(record));
    await flush();
    await h.fail('a', 'boom');
    // The background never retries on its own, and a read within the window leaves it failed.
    h.advance(FAILED_BUILD_WINDOW_MS - 1);
    expect(h.cache.readStates().get('a')).toBe('failed');
    h.advance(1);
    // After the window: back in the queue, behind b (building) and c (queued).
    expect(h.cache.readStates().get('a')).toBe('queued');
    expect(h.changes.filter((c) => c.projectId === 'a').map((c) => c.state)).toEqual([
      'queued',
      'building',
      'failed',
      'queued',
    ]);
    await h.finish('b');
    await h.finish('c');
    expect(h.started).toEqual(['a', 'b', 'c', 'a']);
    await h.finish('a');
    expect(h.cache.getLive('a')).not.toBeNull();
  });

  it('[ac:ac-wywolanie-list-projects-nie-buduje-pr] a list_projects call does not change the order of the build queue', async () => {
    const h = harness();
    const projects = ['a', 'b', 'c', 'd'].map(record);
    const ws = { name: 'default', mode: 'prod', defaultPort: 4500, projects } as unknown as WorkspaceRecord;
    h.cache.start(projects);
    await flush();
    const { server } = buildWorkspaceToolsServer(() => listProjects(ws));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      // The last project of the queue is listed — and is not moved to the front, nor built.
      const res = await client.callTool({ name: 'list_projects', arguments: {} });
      expect(res.isError).not.toBe(true);
      const body = JSON.parse((res.content as Array<{ text: string }>)[0]!.text) as { projects: Array<{ id: string }> };
      expect(body.projects.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
      expect(h.started).toEqual(['a']);
      for (const id of ['a', 'b', 'c']) await h.finish(id);
      expect(h.started).toEqual(['a', 'b', 'c', 'd']);
    } finally {
      await client.close();
    }
  });

  it('[section:l4txpfx0] a request to a project in «needs activation» waits for the activation and the build; a request during a background build that ends in «needs activation» gets the activated context', async () => {
    const h = harness();
    h.cache.start([record('a')]);
    await flush();
    await h.needsActivation('a');
    expect(h.cache.readStates().get('a')).toBe('needs-activation');
    expect(h.activated).toEqual([]);
    // The first request runs the activation (the build with writes) and gets its context.
    expect((await h.cache.get(record('a'))).projectId).toBe('a');
    expect(h.activated).toEqual(['a']);
    expect(h.cache.readStates().get('a')).toBe('ready');

    // A request already waiting while the background build ends in «needs activation».
    const w = harness();
    w.cache.start([record('b')]);
    await flush();
    const waiting = w.cache.get(record('b'));
    await w.needsActivation('b');
    expect((await waiting).projectId).toBe('b');
    expect(w.activated).toEqual(['b']);
  });

  it('[section:m31ctx001] the number of live contexts is not bounded: every project of the composition stays live, idle or not', async () => {
    const h = harness();
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    h.cache.start(ids.map(record));
    await flush();
    for (const id of ids) await h.finish(id);
    h.cache.reapIdle();
    expect(ids.filter((id) => h.cache.getLive(id) === null)).toEqual([]);
  });

  it('[section:m31ctx001] an invalidated context is retired and disposed only once its turns end; its successor is built meanwhile', async () => {
    const busy = { a: true };
    const built: ProjectContext[] = [];
    const cache = new ProjectContextCache(async (p) => {
      const ctx = fakeCtx(p.id, () => busy.a);
      built.push(ctx);
      return ctx;
    });
    caches.push(cache);
    const first = await cache.get(record('a'));
    cache.invalidate('a');
    expect(cache.getLive('a')).toBeNull();
    // The successor is built at once, while the predecessor's turn still runs.
    const second = await cache.get(record('a'));
    expect(second).not.toBe(first);
    expect(built).toHaveLength(2);
    expect(first.dispose).not.toHaveBeenCalled(); // a turn is in flight
    busy.a = false;
    cache.reapIdle();
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
  });

  it('[section:m31ctx001] an invalidation leaves a queued project in the queue: an invalidateAll during the startup sweep drops no project from the background build', async () => {
    const h = harness();
    h.cache.start(['a', 'b', 'c'].map(record));
    await flush();
    expect(h.started).toEqual(['a']);
    // A request waits for `c`, which moves it to the front of the queue.
    const waiting = h.cache.get(record('c'));
    // A base-plugin reload (or a trust / config change) during the sweep.
    h.cache.invalidateAll();
    const states = h.cache.readStates();
    expect(states.get('b')).toBe('queued');
    expect(states.get('c')).toBe('queued');
    // `a` was building: its successor is queued right away.
    expect(states.get('a')).toBe('queued');
    const stale = await h.finish('a');
    // `c` keeps its request-level position; `a` (rebuilt on the current
    // registry) and `b` follow on the invalidated level, in composition order.
    expect(h.started).toEqual(['a', 'c']);
    await h.finish('c');
    expect((await waiting).projectId).toBe('c');
    expect(h.started).toEqual(['a', 'c', 'a']);
    const fresh = await h.finish('a');
    expect(h.started).toEqual(['a', 'c', 'a', 'b']);
    await h.finish('b');
    expect(h.cache.getLive('a')).toBe(fresh);
    expect(stale.dispose).toHaveBeenCalledTimes(1);
    expect(h.cache.getLive('b')?.projectId).toBe('b');
    expect(h.cache.getLive('c')?.projectId).toBe('c');
  });

  it('[ac:ac-projekt-odpiety-zanim-jego-budowa-w-t] [section:m31ctx001] [section:7fgfpqzf] a project detached while it waits in the queue leaves the queue: it is never built, has no state, and its waiting request is rejected', async () => {
    const h = harness();
    h.cache.start(['a', 'b'].map(record));
    await flush();
    expect(h.started).toEqual(['a']);
    const waiting = h.cache.get(record('b'));
    // Detach (DELETE /workspace/projects/b without purge) while `a` builds.
    h.cache.remove('b');
    await expect(waiting).rejects.toThrow("project 'b' was removed from the workspace");
    expect(h.cache.readStates().has('b')).toBe(false);
    await h.finish('a');
    await flush();
    expect(h.started).toEqual(['a']);
    expect(h.activated).toEqual([]);
    expect(h.cache.getLive('b')).toBeNull();
    expect([...h.cache.readStates()]).toEqual([['a', 'ready']]);
  });
});

/**
 * 2.1.60 — M31 `m31ctx001` (invalidation and release), `7fgfpqzf` (detach and
 * purge): an invalidation queues the rebuild at once on the invalidated level;
 * a context is released only at the detach, the invalidation (the predecessor,
 * once its turns end) and the shutdown, which aborts the build in progress.
 */
describe('M31 — invalidation and release of contexts (2.1.60)', () => {
  it('[ac:ac-inwalidacja-kontekstu-uruchamia-jego] [section:m31ctx001] an invalidation of a ready context starts its rebuild without waiting for a request', async () => {
    const h = harness();
    h.cache.start(['a', 'b'].map(record));
    await flush();
    const old = await h.finish('a');
    await h.finish('b');
    expect(h.started).toEqual(['a', 'b']);
    h.cache.invalidate('a');
    await flush();
    // No request was made — the rebuild runs already, and the idle predecessor is released.
    expect(h.started).toEqual(['a', 'b', 'a']);
    expect(h.cache.readStates().get('a')).toBe('building');
    expect(old.dispose).toHaveBeenCalledTimes(1);
    const fresh = await h.finish('a');
    expect(h.cache.getLive('a')).toBe(fresh);
    expect(h.changes.filter((c) => c.projectId === 'a').map((c) => c.state)).toEqual([
      'queued',
      'building',
      'ready',
      'queued',
      'building',
      'ready',
    ]);
  });

  it('[ac:ac-inwalidacja-projektu-w-stanie-bledu-u] [section:m31ctx001] an invalidation of a project in the error state starts its build without waiting for the window to expire', async () => {
    const h = harness();
    const project = record('a');
    h.cache.start([project]);
    await flush();
    await h.fail('a', 'config.json: invalid JSON');
    h.advance(1_000);
    // Well within the ~15 s window: a request still gets the failure, no new attempt.
    await expect(h.cache.get(project)).rejects.toBeInstanceOf(ProjectBuildFailedError);
    expect(h.started).toEqual(['a']);
    // The invalidation (the user fixed the config) clears the window: the build starts at once.
    h.cache.invalidate('a');
    await flush();
    expect(h.started).toEqual(['a', 'a']);
    expect(h.cache.readStates().get('a')).toBe('building');
    const ctx = await h.finish('a');
    expect(h.cache.getLive('a')).toBe(ctx);
    expect((await h.cache.get(project)).projectId).toBe('a');
  });

  it('[ac:ac-inwalidacja-projektu-w-trakcie-jego-b] [section:m31ctx001] an invalidation during the project\'s build starts another build after it, on the current registry; the first result is retired, the waiting request gets the second', async () => {
    let registryRoots = ['pages'];
    const builds: Array<{ roots: string[]; done: Deferred<BackgroundBuildResult<ProjectContext>> }> = [];
    const cache = new ProjectContextCache(
      async () => {
        throw new Error('no activation in this case');
      },
      {
        background: (_p, signal) => {
          // The build reads the registry when it starts.
          const done = deferred<BackgroundBuildResult<ProjectContext>>();
          builds.push({ roots: [...registryRoots], done });
          signal.addEventListener('abort', () => done.reject(signal.reason as Error));
          return done.promise;
        },
      },
    );
    caches.push(cache);
    const ctxOver = (roots: string[]) => Object.assign(fakeCtx('a'), { roots });
    cache.start([record('a')]);
    await flush();
    const waiting = cache.get(record('a'));
    expect(builds).toHaveLength(1);

    // A root is added (the registry switches) and the context invalidated while it builds.
    registryRoots = ['pages', 'adr'];
    cache.invalidate('a');
    await flush();
    expect(builds).toHaveLength(1); // the build in progress runs to its end
    const first = ctxOver(builds[0]!.roots);
    builds[0]!.done.resolve({ state: 'ready', context: first });
    await flush();

    // Its result goes to `retired` (idle → disposed), never served; the next build reads the current registry.
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(builds).toHaveLength(2);
    expect(builds[1]!.roots).toEqual(['pages', 'adr']);
    const second = ctxOver(builds[1]!.roots);
    builds[1]!.done.resolve({ state: 'ready', context: second });
    await flush();
    expect(await waiting).toBe(second);
    expect(cache.getLive('a')).toBe(second);
    expect(builds).toHaveLength(2);
  });

  it('[ac:ac-przy-jednoczesnej-inwalidacji-wielu-p] [section:m31ctx001] at a simultaneous invalidation of many projects the project with a waiting request builds first, then the others in the composition order', async () => {
    const h = harness();
    // The last opened project `c` built first — the entry order is not the composition order.
    h.cache.start(['a', 'b', 'c', 'd'].map(record), 'c');
    await flush();
    for (const id of ['c', 'a', 'b', 'd']) await h.finish(id);
    expect(h.started).toEqual(['c', 'a', 'b', 'd']);
    // A project registered meanwhile is building when the base plugin pool changes.
    h.cache.enqueue(record('e'));
    await flush();
    expect(h.started.slice(4)).toEqual(['e']);
    h.cache.invalidateAll();
    // A tab of `d` asks for it while everything waits for its rebuild.
    const waiting = h.cache.get(record('d'));
    await h.finish('e'); // the build in progress ends (its result is retired)
    expect(h.started.slice(5)).toEqual(['d']);
    await h.finish('d');
    expect((await waiting).projectId).toBe('d');
    for (const id of ['a', 'b', 'c']) await h.finish(id);
    await h.finish('e');
    expect(h.started.slice(5)).toEqual(['d', 'a', 'b', 'c', 'e']);
    expect(['a', 'b', 'c', 'd', 'e'].every((id) => h.cache.getLive(id) !== null)).toBe(true);
  });

  it('[ac:ac-kontekst-projektu-odpietego-w-trakcie] [section:7fgfpqzf] the context of a project detached during its build is released right after that build ends; the waiting request is rejected at once (carried U4a rev-0003)', async () => {
    const h = harness();
    h.cache.start(['a', 'b'].map(record));
    await flush();
    const waiting = h.cache.get(record('a'));
    h.cache.remove('a');
    // The request is not handed to a next build — the project left the workspace.
    await expect(waiting).rejects.toThrow("project 'a' was removed from the workspace");
    expect(h.cache.readStates().has('a')).toBe(false);
    const built = await h.finish('a');
    // Released as soon as the build ended; never served, never rebuilt.
    expect(built.dispose).toHaveBeenCalledTimes(1);
    expect(h.cache.getLive('a')).toBeNull();
    expect(h.started).toEqual(['a', 'b']);
    await h.finish('b');
    expect(h.started).toEqual(['a', 'b']);
    expect([...h.cache.readStates().keys()]).toEqual(['b']);
  });

  it('[section:7fgfpqzf] carried U4a rev-0003: a detach after an invalidation during the build rejects the waiting request instead of handing it to a next build, and leaves no live context behind', async () => {
    const h = harness();
    h.cache.start([record('a')]);
    await flush();
    const waiting = h.cache.get(record('a'));
    // The invalidation hands the request to the successor entry…
    h.cache.invalidate('a');
    // …and the detach drops that successor with the request.
    h.cache.remove('a');
    await expect(waiting).rejects.toThrow("project 'a' was removed from the workspace");
    const built = await h.finish('a');
    await flush();
    expect(built.dispose).toHaveBeenCalledTimes(1);
    expect(h.started).toEqual(['a']);
    expect(h.cache.getLive('a')).toBeNull();
    expect(h.cache.readStates().size).toBe(0);
  });

  it('[section:7fgfpqzf] [section:m31ctx001] a detach releases a ready context — at once when idle, after its turn when one is in flight', async () => {
    const busy = { b: true };
    const cache = new ProjectContextCache(async (p) => fakeCtx(p.id, () => p.id === 'b' && busy.b));
    caches.push(cache);
    const a = await cache.get(record('a'));
    const b = await cache.get(record('b'));
    cache.remove('a');
    cache.remove('b');
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).not.toHaveBeenCalled();
    expect(cache.getLive('a')).toBeNull();
    expect(cache.getLive('b')).toBeNull();
    busy.b = false;
    cache.reapIdle(); // the turn's `finally`
    expect(b.dispose).toHaveBeenCalledTimes(1);
  });

  it('[section:m31ctx001] the shutdown aborts the build in progress and waits until it has released what it held; every waiting request is rejected', async () => {
    const released: string[] = [];
    let signal!: AbortSignal;
    const cache = new ProjectContextCache(
      async () => {
        throw new Error('no activation in this case');
      },
      {
        background: async (_p, s) => {
          signal = s;
          const held: string[] = [];
          try {
            for (const resource of ['db', 'watch']) {
              held.push(resource);
              await flush();
            }
            await new Promise((_resolve, reject) => s.addEventListener('abort', () => reject(s.reason)));
            throw new Error('unreachable');
          } catch (err) {
            for (const resource of held.reverse()) {
              await flush();
              released.push(resource);
            }
            throw err;
          }
        },
      },
    );
    cache.start(['a', 'b'].map(record));
    for (let i = 0; i < 4; i++) await flush();
    // `a` is building, `b` waits in the queue — both with a request.
    const rejectedA = expect(cache.get(record('a'))).rejects.toThrow('the server is shutting down');
    const rejectedB = expect(cache.get(record('b'))).rejects.toThrow('the server is shutting down');
    expect(released).toEqual([]);
    await cache.disposeAll();
    expect(signal.aborted).toBe(true);
    // disposeAll returned only once the partial build released its resources, in reverse order.
    expect(released).toEqual(['watch', 'db']);
    await rejectedA;
    await rejectedB;
    expect(cache.readStates().size).toBe(0);
  });
});
