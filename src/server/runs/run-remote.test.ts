import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLISH_FILE_SUBJECT } from '../services/git.js';
import { RUN_ID_PATTERN } from './run-id.js';
import { compareVersions, runHostsFromSupervisor, runRemote, RunRemoteError, type RunRemoteDeps, type RunRemoteInput } from './run-remote.js';
import { PLAN_EXECUTION_AGENT } from './plan-execution-agent.js';
import {
  deadUrl,
  git,
  host,
  makeRunRemoteFixture,
  RunsApiStub,
  write,
  type RunRemoteFixture,
} from '../../../tests/helpers/run-remote-fixture.js';

/**
 * M55 — `run_remote` (spec-operation `run-remote`) against a real repository
 * with an upstream, the real workspace DB and a local stub of a runner's Runs
 * API.
 */

/** A call from the thread `t1` (the fixture pins `p1.md` to it). */
const run = (deps: RunRemoteDeps, input: RunRemoteInput) => runRemote(deps, { threadId: 't1', ...input });

async function refusal(p: Promise<unknown>): Promise<RunRemoteError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(RunRemoteError);
    return err as RunRemoteError;
  }
  throw new Error('expected a refusal');
}

describe('run_remote (M55)', () => {
  let fx: RunRemoteFixture;
  let stub: RunsApiStub;
  let url: string;

  beforeEach(async () => {
    fx = await makeRunRemoteFixture();
    stub = new RunsApiStub();
    url = await stub.listen();
    fx.hosts.push(host('a', url));
  });

  afterEach(async () => {
    await stub.close();
    fx.dispose();
  });

  const put = () => {
    expect(stub.requests).toHaveLength(1);
    return stub.requests[0]!;
  };

  it('ac-run-remote-zwraca-runid-i-host-przed: returns { runId, host } as soon as the host accepts the order, before the Run starts', async () => {
    // The host only queues the order (`202`, state `queued`): nothing has run yet.
    const result = await run(fx.deps(), {});
    const req = put();
    expect(req.method).toBe('PUT');
    expect(req.url).toBe(`/runs/${result.runId}`);
    expect(req.authorization).toBe('Bearer c4sr_token_a');
    expect(result).toEqual({ runId: result.runId, host: { id: 'a', name: 'name-a' } });
    expect(result.unconfirmed).toBeUndefined();
    expect(fx.rows()).toEqual([{ run_id: result.runId, host_id: 'h_a' }]);
  });

  it('ac-dwa-wywolania-run-remote-daja-dwa-roz: two calls give two different runIds, each a lower-case ULID', async () => {
    const first = await run(fx.deps(), {});
    const second = await run(fx.deps(), {});
    expect(first.runId).not.toBe(second.runId);
    for (const id of [first.runId, second.runId]) {
      expect(id).toMatch(RUN_ID_PATTERN);
      expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
    }
    expect(stub.requests.map((r) => r.url)).toEqual([`/runs/${first.runId}`, `/runs/${second.runId}`]);
  });

  it('[ac:ac-sciezka-planu-w-zleceniu-jest-wzgledn] the plan path in the order is relative to the plans directory of the project — the value the thread holds, not recomputed', async () => {
    write(fx.plansDir, 'sub/p2.md', '---\ntype: plan\ntitle: P2\n---\n# P2\n');
    await fx.pushAll('add sub/p2.md');
    // The pinned plan: the thread holds `sub/p2.md`, and that is what the order carries.
    await run(fx.deps({ pinned: 'sub/p2.md' }), {});
    const { body } = put();
    expect(body.input).toEqual({ kind: 'plan', projectId: 'app', path: 'sub/p2.md' });
    // Not repository- or home-relative (ws/app/plans/sub/p2.md, app/plans/sub/p2.md).
    expect(body.home).toBe('ws');
    // <plans directory of the project>/<input.path> is the plan file.
    expect(fs.existsSync(path.join(fx.plansDir, (body.input as { path: string }).path))).toBe(true);
    expect(fs.existsSync(path.join(fx.repo, body.home as string, (body.input as { path: string }).path))).toBe(false);

    // A plan named explicitly in another project: relative to THAT project's plans directory.
    const docs = fx.addProject('docs');
    await fx.pushAll('add project docs');
    stub.requests.length = 0;
    await run(fx.deps(), { planPath: 'p1.md', projectId: 'docs' });
    expect(put().body.input).toEqual({ kind: 'plan', projectId: 'docs', path: 'p1.md' });
    expect(fs.existsSync(path.join(docs.plansDir, 'p1.md'))).toBe(true);
  });

  it('[ac:ac-zlecenie-z-planem-przypietym-do-watku] the order of the plan pinned to the thread carries the projectId of the thread\'s project', async () => {
    fx.addProject('docs');
    await fx.pushAll('add project docs');
    await run(fx.deps(), {});
    expect(put().body.input).toEqual({ kind: 'plan', projectId: 'app', path: 'p1.md' });
    // The same with the thread's project passed explicitly.
    stub.requests.length = 0;
    await run(fx.deps(), { projectId: 'app' });
    expect(put().body.input).toMatchObject({ kind: 'plan', projectId: 'app' });
  });

  it('[ac:ac-zlecenie-z-promptem-bez-parametru-pro] a prompt without the projectId parameter carries the projectId of the thread\'s project', async () => {
    await run(fx.deps(), { prompt: 'Tidy the glossary.' });
    const { input } = put().body as { input: Record<string, unknown> };
    expect(input).toEqual({ kind: 'prompt', projectId: 'app', text: 'Tidy the glossary.' });
    expect(input.projectId).toBe('app');
  });

  it('[ac:ac-run-remote-z-projectid-spoza-workspac] a projectId outside the workspace ends with RUN_PROJECT_NOT_FOUND — with a prompt and with a plan — and leaves no row and no PUT', async () => {
    for (const input of [{ prompt: 'x', projectId: 'ghost' }, { planPath: 'p1.md', projectId: 'ghost' }]) {
      const err = await refusal(run(fx.deps(), input));
      expect(err.code).toBe('RUN_PROJECT_NOT_FOUND');
      expect(err.message).toContain('ghost');
    }
    expect(fx.rows()).toEqual([]);
    expect(stub.requests).toHaveLength(0);
  });

  it('[ac:ac-run-remote-z-planem-przypietym-do-wat] the plan pinned to the thread with the projectId of another project ends with INVALID_ARGS, with no publication, no row and no PUT', async () => {
    fx.addProject('docs');
    await fx.pushAll('add project docs');
    // A pinned plan that is not pushed: a refusal must come before its publication.
    write(fx.plansDir, 'p1.md', '---\ntype: plan\ntitle: P1\n---\n# P1 — edited\n');
    const before = await fx.upstreamTip();
    const err = await refusal(run(fx.deps(), { projectId: 'docs' }));
    expect(err.code).toBe('INVALID_ARGS');
    expect(await fx.upstreamTip()).toBe(before);
    expect(fx.rows()).toEqual([]);
    expect(stub.requests).toHaveLength(0);
  });

  it('ac-sha-bazy-w-zleceniu-rowna-sie-sha-tip: the base sha in the order equals the upstream tip — also when the upstream moved past the local HEAD', async () => {
    const remoteTip = await fx.pushFromOtherClone('ws/app/pages/other.md', '# other\n');
    const localHead = await git(['rev-parse', 'HEAD'], fx.repo);
    expect(remoteTip).not.toBe(localHead);

    await run(fx.deps(), {});
    const { body } = put();
    expect(body.baseSha).toBe(remoteTip);
    expect(body.baseSha).toBe(await fx.upstreamTip());
    // `repo` is the upstream's remote, computed by the master.
    expect(body.repo).toBe(fx.bare);
  });

  it('ac-niewypchniety-plan-jest-publikowany-p: a plan that is not pushed is published (a commit of the plan file alone, pushed) before the order is sent', async () => {
    write(fx.plansDir, 'p1.md', '---\ntype: plan\ntitle: P1\n---\n# P1 — edited\n');
    write(fx.project, 'pages/index.md', '# index — unrelated local edit\n');
    let tipAtPut: string | null = null;
    const reply = stub.reply;
    stub.reply = (req) => {
      tipAtPut = req.body.baseSha as string;
      return reply(req);
    };

    await run(fx.deps(), {});

    const tip = await fx.upstreamTip();
    expect(await git(['log', '-1', '--format=%s', tip], fx.bare)).toBe(PUBLISH_FILE_SUBJECT);
    expect(await git(['show', '--name-only', '--format=', tip], fx.bare)).toBe('ws/app/plans/p1.md');
    expect(await git(['show', `${tip}:ws/app/plans/p1.md`], fx.bare)).toContain('# P1 — edited');
    // The order went out after the publication, on top of it.
    expect(tipAtPut).toBe(tip);
    // The unrelated edit was not published.
    expect(await git(['status', '--porcelain'], fx.repo)).toContain('ws/app/pages/index.md');
  });

  it('the publication names the calling thread, so its git:status-changed carries it (ASSUMPTION:dev-0008)', async () => {
    write(fx.plansDir, 'p1.md', '# P1 — edited\n');
    const deps = fx.deps();
    const realGit = deps.git;
    const publishFile = vi.fn((p: string, opts?: { threadId?: string | null }) => realGit.publishFile(p, opts));
    const git2: RunRemoteDeps['git'] = {
      probeRepo: () => realGit.probeRepo(),
      workspaceHomePath: (h) => realGit.workspaceHomePath(h),
      checkPathOnUpstream: (p) => realGit.checkPathOnUpstream(p),
      showFile: (s, a, r) => realGit.showFile(s, a, r),
      publishFile,
    };
    await run({ ...deps, git: git2 }, {});
    expect(publishFile).toHaveBeenCalledWith('ws/app/plans/p1.md', { threadId: 't1' });
  });

  it('ac-plik-planu-rozny-na-head-i-upstreamie: a plan file still different on HEAD and the upstream after the publication ends with RUN_PLAN_NOT_ON_UPSTREAM, no row and no PUT', async () => {
    write(fx.plansDir, 'p1.md', '# P1 — edited\n');
    const deps = fx.deps();
    // A publication that reports success but leaves the upstream behind.
    const realGit = deps.git;
    const git2: RunRemoteDeps['git'] = {
      probeRepo: () => realGit.probeRepo(),
      workspaceHomePath: (h) => realGit.workspaceHomePath(h),
      checkPathOnUpstream: (p) => realGit.checkPathOnUpstream(p),
      showFile: (s, a, r) => realGit.showFile(s, a, r),
      publishFile: async () => ({ status: 'published', sha: 'f'.repeat(40), branch: 'main' }),
    };
    const err = await refusal(run({ ...deps, git: git2 }, {}));
    expect(err.code).toBe('RUN_PLAN_NOT_ON_UPSTREAM');
    expect(stub.requests).toHaveLength(0);
    expect(fx.rows()).toEqual([]);
  });

  it('ac-bez-parametru-timeout-zlecenie-nie-ni: without the timeout parameter the order carries no `timeoutMinutes`; a given value passes unchanged', async () => {
    await run(fx.deps(), {});
    expect(put().body).not.toHaveProperty('timeoutMinutes');
    expect(Object.keys(put().body).sort()).toEqual(['agent', 'baseSha', 'home', 'input', 'repo']);

    stub.requests.length = 0;
    await run(fx.deps(), { timeoutMinutes: 45, notes: 'n', model: 'm' });
    expect(put().body).toMatchObject({ timeoutMinutes: 45, notes: 'n', model: 'm' });
  });

  it('ac-git-enabled-false-konczy-sie-git-unav: `git.enabled = false` ends with GIT_UNAVAILABLE', async () => {
    const off = await makeRunRemoteFixture({ gitEnabled: false });
    try {
      off.hosts.push(host('a', url));
      const err = await refusal(run(off.deps(), {}));
      expect(err.code).toBe('GIT_UNAVAILABLE');
      expect(stub.requests).toHaveLength(0);
    } finally {
      off.dispose();
    }
  });

  it('ac-workspace-rejestrowy-konczy-sie-run-w: a registry workspace (no home) ends with RUN_WORKSPACE_WITHOUT_HOME', async () => {
    const err = await refusal(run(fx.deps({ homeless: true }), {}));
    expect(err.code).toBe('RUN_WORKSPACE_WITHOUT_HOME');
    expect(stub.requests).toHaveLength(0);
  });

  it('a project and a home not in one repository end with RUN_PROJECT_OUTSIDE_HOME', async () => {
    const deps = fx.deps();
    const err = await refusal(run({ ...deps, workspace: () => ({ name: 'ws', home: path.join(fx.tmp, 'elsewhere') }) }, {}));
    expect(err.code).toBe('RUN_PROJECT_OUTSIDE_HOME');
  });

  it('ac-jeden-host-polaczony-z-runs-jest-wybi: the one connected host with `runs` is chosen without the host parameter', async () => {
    const other = new RunsApiStub();
    const otherUrl = await other.listen();
    try {
      fx.hosts.length = 0;
      fx.hosts.push(
        host('no-runs', otherUrl, { capabilities: [] }),
        host('down', otherUrl, { status: 'unreachable' }),
        host('a', url),
      );
      const result = await run(fx.deps(), {});
      expect(result.host).toEqual({ id: 'a', name: 'name-a' });
      expect(stub.requests).toHaveLength(1);
      expect(other.requests).toHaveLength(0);
      expect(fx.rows()).toEqual([{ run_id: result.runId, host_id: 'h_a' }]);
    } finally {
      await other.close();
    }
  });

  it('ac-kilka-hostow-polaczonych-bez-parametr: several connected hosts without the host parameter end with RUN_HOST_REQUIRED and the list of hosts', async () => {
    fx.hosts.push(host('b', url), host('c', url, { capabilities: [] }));
    const err = await refusal(run(fx.deps(), {}));
    expect(err.code).toBe('RUN_HOST_REQUIRED');
    expect(err.extra).toEqual({ hosts: [{ id: 'a', name: 'name-a' }, { id: 'b', name: 'name-b' }] });
    expect(stub.requests).toHaveLength(0);
    expect(fx.rows()).toEqual([]);

    // Naming one of them dispatches.
    const result = await run(fx.deps(), { host: 'b' });
    expect(result.host.id).toBe('b');
  });

  it('host selection: no candidate, an unknown host, a host not connected and a host without runs each have their own code', async () => {
    fx.hosts.length = 0;
    fx.hosts.push(host('down', url, { status: 'retrying' }), host('plain', url, { capabilities: [] }));
    expect((await refusal(run(fx.deps(), {}))).code).toBe('RUN_NO_HOST');
    expect((await refusal(run(fx.deps(), { host: 'nope' }))).code).toBe('RUN_HOST_NOT_FOUND');
    expect((await refusal(run(fx.deps(), { host: 'down' }))).code).toBe('RUN_HOST_NOT_CONNECTED');
    expect((await refusal(run(fx.deps(), { host: 'plain' }))).code).toBe('RUN_HOST_WITHOUT_RUNS');
    expect(stub.requests).toHaveLength(0);
  });

  describe('the environment recipe (kcxoa7qg)', () => {
    const recipe = (o: Record<string, unknown>) => write(fx.home, '.c4s-runner/environment.json', JSON.stringify(o));

    it('ac-wersja-c4s-w-przepisie-nizsza-od-mini: a c4s version in the recipe lower than the definition\'s minimum ends with RUN_C4S_VERSION_INCOMPATIBLE, no row and no PUT', async () => {
      recipe({ schemaVersion: 1, c4sVersion: '2.0.0', image: 'node:22' });
      await fx.pushAll('recipe');
      const err = await refusal(run(fx.deps(), {}));
      expect(err.code).toBe('RUN_C4S_VERSION_INCOMPATIBLE');
      expect(compareVersions('2.0.0', PLAN_EXECUTION_AGENT.minC4sVersion)).toBeLessThan(0);
      expect(stub.requests).toHaveLength(0);
      expect(fx.rows()).toEqual([]);

      // The minimum itself passes.
      recipe({ schemaVersion: 1, c4sVersion: PLAN_EXECUTION_AGENT.minC4sVersion, image: 'node:22' });
      await fx.pushAll('recipe at the minimum');
      await run(fx.deps(), {});
      expect(stub.requests).toHaveLength(1);
    });

    it('the recipe is read at the base sha, not in the working tree', async () => {
      recipe({ schemaVersion: 1, c4sVersion: '2.0.0' });
      // Not committed: the base sha has no recipe.
      await run(fx.deps(), {});
      expect(stub.requests).toHaveLength(1);
    });

    it('ac-brak-przepisu-w-sha-bazy-nie-daje-odm: no recipe at the base sha gives no refusal of the master; nor does an unreadable one', async () => {
      await run(fx.deps(), {});
      expect(stub.requests).toHaveLength(1);

      write(fx.home, '.c4s-runner/environment.json', '{ not json');
      await fx.pushAll('broken recipe');
      await run(fx.deps(), {});
      expect(stub.requests).toHaveLength(2);
    });

    it('ac-przepis-o-nieznanej-schemaversion-nie: a recipe of an unknown `schemaVersion` gives no refusal of the master, whatever its `c4sVersion`', async () => {
      recipe({ schemaVersion: 2, c4sVersion: '0.0.1' });
      await fx.pushAll('recipe v2');
      const result = await run(fx.deps(), {});
      expect(result.runId).toMatch(RUN_ID_PATTERN);
      expect(stub.requests).toHaveLength(1);
    });
  });

  describe('the host\'s answer to PUT', () => {
    it('ac-odmowa-400-invalid-request-usuwa-wpis: a `400 invalid_request` refusal deletes the registry row written before the PUT', async () => {
      let rowsAtPut: unknown[] = [];
      stub.reply = () => {
        rowsAtPut = fx.rows();
        return { status: 400, body: { code: 'invalid_request', message: '`model` is not on this host\'s model list.', field: 'model' } };
      };
      const err = await refusal(run(fx.deps(), { model: 'x' }));
      expect(err.code).toBe('RUN_REJECTED');
      expect(err.extra).toEqual({ field: 'model' });
      expect(rowsAtPut).toHaveLength(1);
      expect(fx.rows()).toEqual([]);
    });

    it('ac-repo-kotwicy-spoza-gatewayrepos-hosta: an anchor repo outside the host\'s `gatewayRepos` ends with RUN_REJECTED carrying the field `repo`', async () => {
      const gatewayRepos = new Set(['https://github.com/acme/spec.git']);
      stub.reply = (req) =>
        gatewayRepos.has(req.body.repo as string)
          ? { status: 202, body: {} }
          : { status: 400, body: { code: 'invalid_request', message: "The repository is not on this host's allowed list.", field: 'repo' } };
      const err = await refusal(run(fx.deps(), {}));
      expect(put().body.repo).toBe(fx.bare);
      expect(err.code).toBe('RUN_REJECTED');
      expect(err.extra).toEqual({ field: 'repo' });
      expect(fx.rows()).toEqual([]);
    });

    it('ac-put-z-odpowiedzia-404-not-found-koncz: `PUT` answered `404 not_found` ends with RUN_HOST_WITHOUT_RUNS', async () => {
      stub.reply = () => ({ status: 404, body: { code: 'not_found', message: 'No such endpoint.' } });
      const err = await refusal(run(fx.deps(), {}));
      expect(err.code).toBe('RUN_HOST_WITHOUT_RUNS');
      expect(fx.rows()).toEqual([]);
    });

    it('ac-put-z-odpowiedzia-409-conflict-konczy: `PUT` answered `409 conflict` ends with RUN_INTERNAL, without a retry under that runId', async () => {
      stub.reply = () => ({ status: 409, body: { code: 'conflict', message: 'This runId already names a Run with a different order.' } });
      const err = await refusal(run(fx.deps(), {}));
      expect(err.code).toBe('RUN_INTERNAL');
      // Exactly one PUT: no retry, neither with this runId nor another.
      expect(stub.requests).toHaveLength(1);
      expect(fx.rows()).toEqual([]);
    });

    it('the shared mapping: `401 unauthenticated` → RUN_HOST_UNAUTHENTICATED (row deleted), `500 internal` and an unknown code → RUN_HOST_ERROR', async () => {
      stub.reply = () => ({ status: 401, body: { code: 'unauthenticated', message: 'no' } });
      expect((await refusal(run(fx.deps(), {}))).code).toBe('RUN_HOST_UNAUTHENTICATED');
      expect(fx.rows()).toEqual([]);

      stub.reply = () => ({ status: 500, body: { code: 'internal', message: 'boom' } });
      expect((await refusal(run(fx.deps(), {}))).code).toBe('RUN_HOST_ERROR');
      stub.reply = () => ({ status: 418, body: { code: 'teapot' } });
      expect((await refusal(run(fx.deps(), {}))).code).toBe('RUN_HOST_ERROR');
    });

    it('ac-blad-sieci-przy-put-zostawia-wpis-rej: a network error at the PUT keeps the registry row and answers unconfirmed, not a refusal', async () => {
      fx.hosts.length = 0;
      fx.hosts.push(host('gone', await deadUrl()));
      const result = await run(fx.deps(), {});
      expect(result).toEqual({ runId: result.runId, host: { id: 'gone', name: 'name-gone' }, unconfirmed: true });
      expect(fx.rows()).toEqual([{ run_id: result.runId, host_id: 'h_gone' }]);
    });
  });

  it('a prompt checks the workspace description on the upstream, publishes nothing and orders the prompt for the current project by default', async () => {
    write(fx.plansDir, 'p1.md', '# P1 — not pushed\n');
    const before = await fx.upstreamTip();
    await run(fx.deps(), { prompt: 'Tidy the glossary.' });
    expect(await fx.upstreamTip()).toBe(before);
    expect(put().body.input).toEqual({ kind: 'prompt', projectId: 'app', text: 'Tidy the glossary.' });

    write(fx.home, '.claude4spec/workspace.json', '{"projects":[]}');
    const err = await refusal(run(fx.deps(), { prompt: 'x' }));
    expect(err.code).toBe('RUN_PLAN_NOT_ON_UPSTREAM');
  });

  it('addressing: planPath with prompt, and no plan at all, are INVALID_ARGS; an unknown plan is PLAN_NOT_FOUND (also in the plans directory of an explicit project); an unknown agent RUN_AGENT_NOT_FOUND', async () => {
    fx.addProject('docs');
    write(fx.plansDir, 'only-in-app.md', '# app only\n');
    expect((await refusal(run(fx.deps(), { planPath: 'p1.md', prompt: 'x' }))).code).toBe('INVALID_ARGS');
    expect((await refusal(run(fx.deps({ pinned: null }), {}))).code).toBe('INVALID_ARGS');
    expect((await refusal(run(fx.deps(), { planPath: 'nope.md' }))).code).toBe('PLAN_NOT_FOUND');
    // An explicit plan is looked up in the plans directory of the project named, not the thread's.
    expect((await refusal(run(fx.deps(), { planPath: 'only-in-app.md', projectId: 'docs' }))).code).toBe('PLAN_NOT_FOUND');
    expect((await refusal(run(fx.deps(), { planPath: '../../../app/plans/p1.md', projectId: 'docs' }))).code).toBe('PLAN_NOT_FOUND');
    expect((await refusal(run(fx.deps(), { agent: 'other' }))).code).toBe('RUN_AGENT_NOT_FOUND');
    expect(stub.requests).toHaveLength(0);
  });

  it('a plan of another project reached through a symlink inside its plans directory that points outside it is PLAN_NOT_FOUND, with no publication, no row and no PUT (rev-0001)', async () => {
    const docs = fx.addProject('docs');
    await fx.pushAll('add project docs');
    // A file of the repository outside docs' plans directory, and a link to it from inside.
    write(fx.repo, 'secret.md', '# not a plan\n');
    await fx.pushAll('add secret.md');
    fs.symlinkSync(path.join(fx.repo, 'secret.md'), path.join(docs.plansDir, 'escape.md'));
    // A symlinked directory inside the plans directory pointing at another project's plans.
    fs.symlinkSync(fx.plansDir, path.join(docs.plansDir, 'linked'));
    const headBefore = await git(['rev-parse', 'HEAD'], fx.repo);
    for (const planPath of ['escape.md', 'linked/p1.md']) {
      const err = await refusal(run(fx.deps(), { planPath, projectId: 'docs' }));
      expect(err.code).toBe('PLAN_NOT_FOUND');
    }
    expect(await git(['rev-parse', 'HEAD'], fx.repo)).toBe(headBefore);
    expect(fx.rows()).toEqual([]);
    expect(stub.requests).toHaveLength(0);
  });

  it('an agent named after an Object.prototype key (constructor, toString, __proto__) is RUN_AGENT_NOT_FOUND, with no registry row and no PUT', async () => {
    for (const agent of ['constructor', 'toString', '__proto__']) {
      const err = await refusal(run(fx.deps(), { agent }));
      expect(err.code).toBe('RUN_AGENT_NOT_FOUND');
    }
    expect(fx.rows()).toEqual([]);
    expect(stub.requests).toHaveLength(0);
  });

  it('a plans directory under a home directory whose name begins with two dots (`..drafts/`) is in the repository, not RUN_PROJECT_OUTSIDE_HOME', async () => {
    const drafts = path.join(fx.home, '..drafts');
    write(drafts, 'plan.md', '---\ntype: plan\ntitle: Draft\n---\n# Draft\n');
    await fx.pushAll('add ..drafts/plan.md');
    const deps = fx.deps({
      plans: { rootDir: drafts, pinnedPlanPath: () => null, exists: async (p) => fs.existsSync(path.join(drafts, p)) },
    });
    await run(deps, { planPath: 'plan.md' });
    const { body } = put();
    expect(body.home).toBe('ws');
    expect(body.input).toEqual({ kind: 'plan', projectId: 'app', path: 'plan.md' });
    // The publication and the upstream check took the file's repository path.
    expect(body.baseSha).toBe(await fx.upstreamTip());
  });

  it('[ac:ac-run-remote-bez-parametru-agent-zleca] run_remote without the `agent` parameter orders the Run with the "plan-execution" definition', async () => {
    const result = await run(fx.deps(), {});
    expect(result.runId).toBeDefined();
    expect(put().body.agent).toEqual({
      name: 'plan-execution',
      version: PLAN_EXECUTION_AGENT.version,
      content: PLAN_EXECUTION_AGENT.content,
    });
  });

  it('"plan-execution" replaces "shadow": an order naming the agent "shadow" is RUN_AGENT_NOT_FOUND, with no PUT', async () => {
    const err = await refusal(run(fx.deps(), { agent: 'shadow' }));
    expect(err.code).toBe('RUN_AGENT_NOT_FOUND');
    expect(stub.requests).toHaveLength(0);
  });

  it('runHostsFromSupervisor names each host by its label, else the bound host name', () => {
    const read = { url: 'u', token: 't', status: 'connected' as const, hostId: 'h', capabilities: ['runs'] };
    const hosts = runHostsFromSupervisor({
      readHosts: () => [{ id: 'x', ...read }, { id: 'y', ...read }, { id: 'z', ...read }],
      list: () => [
        { record: { id: 'x', label: 'Lab', binding: { hostName: 'kb' } } },
        { record: { id: 'y', binding: { hostName: 'kb-ec2' } } },
        { record: { id: 'z', binding: null } },
      ],
    });
    expect(hosts.map((h) => h.name)).toEqual(['Lab', 'kb-ec2', null]);
  });
});
