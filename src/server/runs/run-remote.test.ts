import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLISH_FILE_SUBJECT } from '../services/git.js';
import { RUN_ID_PATTERN } from './run-id.js';
import {
  compareVersions,
  runHostsFromSupervisor,
  runLocalConsentOf,
  runRemote,
  RunRemoteError,
  TRUST_WARNING_PLUGINS,
  TRUST_WARNING_SKILL_USES,
  type RunLocalConsent,
  type RunRemoteDeps,
  type RunRemoteInput,
} from './run-remote.js';
import { runConsentNeedsOf } from './run-consent-needs.js';
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

  it('[ac:ac-sha-bazy-w-zleceniu-rowna-sie-sha-tip] the base sha in an order without fromRunId equals the upstream tip — also when the upstream moved past the local HEAD', async () => {
    const remoteTip = await fx.pushFromOtherClone('ws/app/pages/other.md', '# other\n');
    const localHead = await git(['rev-parse', 'HEAD'], fx.repo);
    expect(remoteTip).not.toBe(localHead);

    await run(fx.deps(), {});
    const { body } = put();
    expect(body.baseSha).toBe(remoteTip);
    expect(body.baseSha).toBe(await fx.upstreamTip());
    // `repo` is the upstream's remote, computed by the master.
    expect(body.repo).toBe(fx.bare);
    // Without fromRunId the order is no continuation.
    expect(body).not.toHaveProperty('continuation');
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
      fetch: () => realGit.fetch(),
      shadowTip: (id, r) => realGit.shadowTip(id, r),
      resolveShadow: (id, r, o) => realGit.resolveShadow(id, r, o),
      upstreamRemoteUrl: () => realGit.upstreamRemoteUrl(),
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
      fetch: () => realGit.fetch(),
      shadowTip: (id, r) => realGit.shadowTip(id, r),
      resolveShadow: (id, r, o) => realGit.resolveShadow(id, r, o),
      upstreamRemoteUrl: () => realGit.upstreamRemoteUrl(),
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

  describe('the trust in the order (jlgucjnq)', () => {
    /** The registry's stored `projectTrust`, read the way the server reads it. */
    const consentDeps = (projectTrust: Record<string, RunLocalConsent>, over: Partial<RunRemoteDeps> = {}) =>
      fx.deps({
        localConsent: (id) => runLocalConsentOf(projectTrust, id),
        consentNeeds: (id) => runConsentNeedsOf(id === 'app' ? fx.project : path.join(fx.home, id)),
        ...over,
      });

    it('[ac:ac-zlecenie-runu-projektu-z-lokalnym-zau] the order of a project with a local plugin trust for the path of workspace.json at the base sha carries that trust (and the confirmed skill attachments)', async () => {
      write(fx.project, '.claude4spec/plugins/acme/package.json', '{"name":"acme"}');
      await fx.pushAll('project plugin');
      const result = await run(consentDeps({ app: { path: 'app', trustProjectPlugins: true, confirmedSkillUses: ['layered-vertical-slices'] } }), {});
      expect(put().body.c4sTrust).toEqual({
        projects: { app: { path: 'app', trustProjectPlugins: true, skillAttachments: ['layered-vertical-slices'] } },
      });
      // Granted and sent: nothing to warn about.
      expect(result.warnings).toBeUndefined();
      expect(result).toEqual({ runId: result.runId, host: { id: 'a', name: 'name-a' } });
    });

    it('[ac:ac-zlecenie-runu-projektu-z-lokalnym-zau] a path equal in its canonical form (`app/`) is the same path; a plugin trust alone goes without skillAttachments, and a refused trust (false) sends nothing', async () => {
      // 2.1.69 (M31 `44viw74p`): the one tolerated trailing `/` is not part of the path.
      await run(consentDeps({ app: { path: 'app/', trustProjectPlugins: true } }), {});
      expect(put().body.c4sTrust).toEqual({ projects: { app: { path: 'app/', trustProjectPlugins: true } } });

      // `./app` is not the canonical `app`: the consent is for another path.
      stub.requests.length = 0;
      const other = await run(consentDeps({ app: { path: './app', trustProjectPlugins: true } }), {});
      expect(put().body).not.toHaveProperty('c4sTrust');
      expect(other.warnings).toEqual([expect.stringContaining("is for path './app'")]);

      stub.requests.length = 0;
      await run(consentDeps({ app: { path: 'app', trustProjectPlugins: false } }), {});
      expect(put().body).not.toHaveProperty('c4sTrust');
    });

    it('[ac:ac-zlecenie-runu-nie-niesie-zaufania-pro] the order carries no trust of a project other than the Run\'s project', async () => {
      fx.addProject('docs');
      await fx.pushAll('add project docs');
      const trust = {
        app: { path: 'app', trustProjectPlugins: true, confirmedSkillUses: ['a-skill'] },
        docs: { path: 'docs', trustProjectPlugins: true, confirmedSkillUses: ['d-skill'] },
      };
      // The thread's project: only `app`.
      await run(consentDeps(trust), {});
      expect(Object.keys((put().body.c4sTrust as { projects: object }).projects)).toEqual(['app']);
      expect(JSON.stringify(put().body)).not.toContain('d-skill');

      // A Run of `docs`: only `docs`, never the thread's project.
      stub.requests.length = 0;
      await run(consentDeps(trust), { prompt: 'Tidy docs.', projectId: 'docs' });
      expect(put().body.c4sTrust).toEqual({ projects: { docs: { path: 'docs', trustProjectPlugins: true, skillAttachments: ['d-skill'] } } });
      expect(JSON.stringify(put().body)).not.toContain('a-skill');

      // A Run of a project with no consent of its own carries none, though another project has one.
      stub.requests.length = 0;
      await run(consentDeps({ docs: trust.docs }), {});
      expect(put().body).not.toHaveProperty('c4sTrust');
    });

    it('[ac:ac-zlecenie-runu-projektu-ktorego-lokaln] the order of a project whose local consent is for another path than workspace.json at the base sha carries no trust — and warns, without refusing', async () => {
      // The consent was given under `old-app`; the base sha lists the project under `app`.
      const moved = await run(consentDeps({ app: { path: 'old-app', trustProjectPlugins: true, confirmedSkillUses: ['x'] } }), {});
      expect(put().body).not.toHaveProperty('c4sTrust');
      expect(moved.warnings).toHaveLength(1);
      expect(moved.warnings![0]).toContain("'old-app'");
      expect(moved.warnings![0]).toContain("'app'");
      expect(fx.rows()).toEqual([{ run_id: moved.runId, host_id: 'h_a' }]);

      // One cause, one warning: a project that also needs plugins and skill uses
      // gets the mismatch warning alone, not the "without local approval" ones.
      stub.requests.length = 0;
      const movedNeeds = await run(
        consentDeps(
          { app: { path: 'old-app', trustProjectPlugins: true, confirmedSkillUses: ['x'] } },
          { consentNeeds: () => ({ plugins: true, skillUses: ['x', 'y'] }) },
        ),
        {},
      );
      expect(put().body).not.toHaveProperty('c4sTrust');
      expect(movedNeeds.warnings).toEqual([moved.warnings![0]]);
      expect(movedNeeds.warnings![0]).not.toContain(TRUST_WARNING_PLUGINS);

      // The path is read at the base sha, not in the working tree: the project
      // renamed to `app2` in an uncommitted workspace.json, the consent given for
      // `app2` — the base sha still says `app`, so no trust goes.
      write(fx.home, '.claude4spec/workspace.json', JSON.stringify({ projects: [{ id: 'app', path: 'app2' }] }));
      stub.requests.length = 0;
      const local = await run(consentDeps({ app: { path: 'app2', trustProjectPlugins: true } }), {});
      expect(put().body).not.toHaveProperty('c4sTrust');
      expect(local.warnings![0]).toContain("'app2'");
    });

    it('[entity:run-remote] no consent and a project with plugins and skill uses: nothing about trust is sent, the answer warns, and nothing is refused', async () => {
      const result = await run(consentDeps({}, { consentNeeds: () => ({ plugins: true, skillUses: ['s1', 's2'] }) }), {});
      expect(put().body).not.toHaveProperty('c4sTrust');
      expect(result.warnings).toEqual([TRUST_WARNING_PLUGINS, `${TRUST_WARNING_SKILL_USES}: s1, s2`]);

      // Skill uses confirmed in part: the confirmed one goes, the other is warned about.
      stub.requests.length = 0;
      const partial = await run(
        consentDeps({ app: { path: 'app', confirmedSkillUses: ['s1'] } }, { consentNeeds: () => ({ plugins: false, skillUses: ['s1', 's2'] }) }),
        {},
      );
      expect(put().body.c4sTrust).toEqual({ projects: { app: { path: 'app', skillAttachments: ['s1'] } } });
      expect(partial.warnings).toEqual([`${TRUST_WARNING_SKILL_USES}: s2`]);
    });

    it('[entity:run-remote] the trust step stands between the version check and the registry: a version refusal reads no consent; the trust reaches neither the registry nor a commit', async () => {
      const localConsent = vi.fn((id: string) => runLocalConsentOf({ app: { path: 'app', trustProjectPlugins: true } }, id));
      write(fx.home, '.c4s-runner/environment.json', JSON.stringify({ schemaVersion: 1, c4sVersion: '2.0.0' }));
      await fx.pushAll('old recipe');
      expect((await refusal(run(fx.deps({ localConsent }), {}))).code).toBe('RUN_C4S_VERSION_INCOMPATIBLE');
      expect(localConsent).not.toHaveBeenCalled();

      write(fx.home, '.c4s-runner/environment.json', JSON.stringify({ schemaVersion: 1, c4sVersion: PLAN_EXECUTION_AGENT.minC4sVersion }));
      const tip = await fx.pushAll('recipe at the minimum');
      let rowsAtPut: unknown[] = [];
      stub.reply = (req) => {
        rowsAtPut = fx.rows();
        return { status: 202, body: { runId: req.url.split('/').pop(), state: 'queued' } };
      };
      const result = await run(fx.deps({ localConsent }), {});
      expect(localConsent).toHaveBeenCalledWith('app');
      expect(put().body.c4sTrust).toEqual({ projects: { app: { path: 'app', trustProjectPlugins: true } } });
      // The row is written before the PUT and holds only runId → hostId.
      expect(rowsAtPut).toEqual([{ run_id: result.runId, host_id: 'h_a' }]);
      // No commit: the plan was pushed, so the upstream is where it was.
      expect(await fx.upstreamTip()).toBe(tip);
      expect(await git(['log', '-1', '--format=%H'], fx.repo)).toBe(tip);
    });

    it('[section:jlgucjnq] a consent with `trustProjectPlugins: false` and no confirmed names sends no trust entry; an empty attachment list never enters the entry', async () => {
      // 2.1.69: nothing granted — no entry at all, and no path-mismatch warning either.
      const nothing = await run(
        consentDeps({ app: { path: 'app', trustProjectPlugins: false, confirmedSkillUses: [] } }, { consentNeeds: () => ({ plugins: false, skillUses: [] }) }),
        {},
      );
      expect(put().body).not.toHaveProperty('c4sTrust');
      expect(nothing.warnings).toBeUndefined();

      // Plugin trust granted, attachment list empty: the entry goes without `skillAttachments`.
      stub.requests.length = 0;
      await run(consentDeps({ app: { path: 'app', trustProjectPlugins: true, confirmedSkillUses: [] } }), {});
      const entry = (put().body.c4sTrust as { projects: Record<string, Record<string, unknown>> }).projects.app!;
      expect(entry).toEqual({ path: 'app', trustProjectPlugins: true });
      expect(entry).not.toHaveProperty('skillAttachments');
    });

    it('[section:jlgucjnq] at most three distinct warnings: plugins without a granted trust, unconfirmed `skill.uses` with their list, a consent for another path — which then stands alone', async () => {
      const needs = { consentNeeds: () => ({ plugins: true, skillUses: ['s1', 's2'] }) };
      // No consent: the plugins warning and the skill-uses warning, each its own text.
      const none = await run(consentDeps({}, needs), {});
      expect(none.warnings).toEqual([TRUST_WARNING_PLUGINS, `${TRUST_WARNING_SKILL_USES}: s1, s2`]);
      expect(new Set(none.warnings).size).toBe(2);
      expect(none.warnings!.some((w) => w.includes('is for path'))).toBe(false);

      // A consent for another path: one warning, the path one, never the other two.
      stub.requests.length = 0;
      const moved = await run(consentDeps({ app: { path: 'old-app', trustProjectPlugins: true, confirmedSkillUses: ['s1'] } }, needs), {});
      expect(moved.warnings).toHaveLength(1);
      expect(moved.warnings![0]).toContain("is for path 'old-app'");
      expect(moved.warnings![0]).not.toContain(TRUST_WARNING_PLUGINS);
      expect(moved.warnings![0]).not.toContain(TRUST_WARNING_SKILL_USES);
      expect(put().body).not.toHaveProperty('c4sTrust');
    });

    it('[entity:run-remote] a network error at the PUT keeps the warnings next to `unconfirmed`', async () => {
      fx.hosts.length = 0;
      fx.hosts.push(host('gone', await deadUrl()));
      const result = await run(consentDeps({}, { consentNeeds: () => ({ plugins: true, skillUses: [] }) }), {});
      expect(result).toEqual({ runId: result.runId, host: { id: 'gone', name: 'name-gone' }, unconfirmed: true, warnings: [TRUST_WARNING_PLUGINS] });
    });
  });
});

/**
 * 2.1.68 — the continuation of a Run (`fromRunId`, M55 `fdu51xri`): the parent
 * recognized before any registry row, the base sha at the tip of the parent's
 * result ref, the parent's host by default, no publication of the plan.
 */
describe('run_remote with fromRunId — the continuation (M55 fdu51xri)', () => {
  const PARENT = '01jb3k9x7q2m4n5p6r8s0t1v2w';
  const CONTINUATION = ['runs', 'run-continuation'];
  let fx: RunRemoteFixture;
  let stub: RunsApiStub;
  let url: string;

  /** `c4s-runner` dto `run-record` of the parent: a plan of `app`, run on host `h_a`. */
  const parentRecord = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    runId: PARENT,
    hostId: 'h_a',
    runnerVersion: '0.6.0',
    contractVersion: 1,
    repo: 'github.com/acme/workspace',
    baseSha: '3f2a9c1e7b4d6f8a0c2e4b6d8f1a3c5e7b9d0f2a',
    resultRef: `refs/runs/${PARENT}/work`,
    agent: { name: 'plan-execution', version: '4' },
    input: { kind: 'plan', projectId: 'app', path: 'p1.md' },
    model: 'opus',
    startedAt: '2026-11-03T10:00:02Z',
    finishedAt: '2026-11-03T10:41:05Z',
    outcome: 'partial',
    handoff: { summary: 'Did 4 of 6.', decisions: [], conflicts: [], commits: [] },
    ...over,
  });

  /** A parent ordered from this workspace (row on `h_a`) that left its result ref; returns its `resultSha`. */
  const parentWithResult = async (over: Record<string, unknown> = {}, id = PARENT): Promise<string> => {
    fx.registry.insert(id, 'h_a');
    return fx.pushRunRecord(id, parentRecord({ runId: id, resultRef: `refs/runs/${id}/work`, ...over }), {
      [`ws/app/pages/${id}.md`]: `# by Run ${id}\n`,
    });
  };

  const put = () => {
    expect(stub.requests).toHaveLength(1);
    return stub.requests[0]!;
  };

  beforeEach(async () => {
    fx = await makeRunRemoteFixture();
    stub = new RunsApiStub();
    url = await stub.listen();
    fx.hosts.push(host('a', url, { capabilities: CONTINUATION }));
  });

  afterEach(async () => {
    await stub.close();
    fx.dispose();
  });

  it('[ac:ac-sha-bazy-w-zleceniu-z-fromrunid-rowna] the base sha of an order with fromRunId equals the tip of refs/runs/<fromRunId>/work after fetch() — not the upstream tip', async () => {
    const resultSha = await parentWithResult();
    // Before the call the result ref is only on the remote: the operation's fetch() brings it.
    expect(await fx.git.shadowTip(`${PARENT}/work`)).toBeNull();
    const upstreamTip = await fx.pushFromOtherClone('ws/app/pages/other.md', '# other\n');

    await run(fx.deps(), { fromRunId: PARENT });

    const { body } = put();
    expect(body.baseSha).toBe(resultSha);
    expect(body.baseSha).toBe(await fx.git.shadowTip(`${PARENT}/work`));
    expect(body.baseSha).not.toBe(upstreamTip);
    // `repo` is still the upstream's remote, computed by the master.
    expect(body.repo).toBe(fx.bare);
  });

  it('[ac:ac-zlecenie-z-fromrunid-niesie-continuat] the order with fromRunId carries continuation.parentRunId equal to fromRunId (no instruction when none is given)', async () => {
    await parentWithResult();
    await run(fx.deps(), { fromRunId: PARENT });
    expect(put().body.continuation).toEqual({ parentRunId: PARENT });
  });

  it('[ac:ac-zlecenie-z-fromrunid-i-instruction-ni] the order with fromRunId and instruction carries continuation.instruction equal to instruction', async () => {
    await parentWithResult();
    const instruction = 'Finish entries 5 and 6; entry 5 now follows M12.';
    await run(fx.deps(), { fromRunId: PARENT, instruction });
    const { continuation } = put().body as { continuation: Record<string, unknown> };
    expect(continuation.instruction).toBe(instruction);
    expect(continuation).toEqual({ parentRunId: PARENT, instruction });
  });

  it('[ac:ac-zlecenie-z-fromrunid-niesie-projectid] the order with fromRunId carries the projectId and the plan path of the parent\'s record — not the thread\'s project or its pinned plan', async () => {
    const docs = fx.addProject('docs');
    write(docs.plansDir, 'q7.md', '---\ntype: plan\ntitle: Q7\n---\n# Q7\n');
    await fx.pushAll('add project docs with plan q7.md');
    await parentWithResult({ input: { kind: 'plan', projectId: 'docs', path: 'q7.md' } });

    // The thread belongs to `app` and pins `p1.md`.
    await run(fx.deps({ pinned: 'p1.md' }), { fromRunId: PARENT });

    const { input } = put().body as { input: Record<string, unknown> };
    expect(input).toEqual({ kind: 'plan', projectId: 'docs', path: 'q7.md' });
    expect(input.projectId).toBe('docs');
    expect(input.path).toBe('q7.md');
  });

  it('[ac:ac-zlecenie-z-fromrunid-nie-publikuje-pl] the order with fromRunId does not publish the plan — no commit, no push, no path check on the upstream — even with the plan edited locally', async () => {
    await parentWithResult();
    write(fx.plansDir, 'p1.md', '---\ntype: plan\ntitle: P1\n---\n# P1 — edited after the parent\n');
    const tipBefore = await fx.upstreamTip();
    const headBefore = await git(['rev-parse', 'HEAD'], fx.repo);
    const publishFile = vi.spyOn(fx.git, 'publishFile');
    const checkPath = vi.spyOn(fx.git, 'checkPathOnUpstream');

    await run(fx.deps(), { fromRunId: PARENT });

    expect(publishFile).not.toHaveBeenCalled();
    expect(checkPath).not.toHaveBeenCalled();
    expect(await fx.upstreamTip()).toBe(tipBefore);
    expect(await git(['rev-parse', 'HEAD'], fx.repo)).toBe(headBefore);
    expect(await git(['status', '--porcelain'], fx.repo)).toContain('ws/app/plans/p1.md');
    expect(put().body.input).toEqual({ kind: 'plan', projectId: 'app', path: 'p1.md' });
  });

  it('[ac:ac-wiersz-rejestru-runu-kontynuacji-nies] the registry row of a continuation Run carries the runId of the parent; a Run without a parent carries none', async () => {
    await parentWithResult();
    const child = await run(fx.deps(), { fromRunId: PARENT });
    const plain = await run(fx.deps(), {});
    const rows = fx.rowsWithParent();
    expect(rows.find((r) => r.run_id === child.runId)).toEqual({ run_id: child.runId, host_id: 'h_a', parent_run_id: PARENT });
    expect(rows.find((r) => r.run_id === plain.runId)).toEqual({ run_id: plain.runId, host_id: 'h_a', parent_run_id: null });
    expect(fx.registry.get(child.runId)?.parentRunId).toBe(PARENT);
  });

  it('[ac:ac-run-remote-z-fromrunid-bez-parametru] run_remote with fromRunId and no host parameter orders the Run on the parent\'s host — also with several connected hosts', async () => {
    await parentWithResult();
    const other = new RunsApiStub();
    try {
      fx.hosts.unshift(host('b', await other.listen(), { capabilities: CONTINUATION }));
      const result = await run(fx.deps(), { fromRunId: PARENT });
      expect(result.host).toEqual({ id: 'a', name: 'name-a' });
      expect(put().url).toBe(`/runs/${result.runId}`);
      expect(put().authorization).toBe('Bearer c4sr_token_a');
      expect(other.requests).toHaveLength(0);
      expect(fx.rowsWithParent().find((r) => r.run_id === result.runId)?.host_id).toBe('h_a');
    } finally {
      await other.close();
    }
  });

  it('[ac:ac-run-remote-z-fromrunid-bez-parametru] without a registry row the parent\'s host is the record\'s hostId', async () => {
    // The parent's row is gone (e.g. a new workspace DB); its record names h_a.
    await fx.pushRunRecord(PARENT, parentRecord(), { 'ws/app/pages/x.md': '# x\n' });
    fx.hosts.unshift(host('b', await deadUrl(), { capabilities: CONTINUATION }));
    const result = await run(fx.deps(), { fromRunId: PARENT });
    expect(result.host.id).toBe('a');
    expect(put().body.continuation).toEqual({ parentRunId: PARENT });
  });

  it('[entity:run-remote] the parent\'s host without a host record ends with RUN_HOST_NOT_FOUND, with no row and no PUT', async () => {
    await parentWithResult({ hostId: 'h_gone' });
    fx.registry.delete(PARENT);
    fx.registry.insert(PARENT, 'h_gone');
    const err = await refusal(run(fx.deps(), { fromRunId: PARENT }));
    expect(err.code).toBe('RUN_HOST_NOT_FOUND');
    expect(fx.rows()).toEqual([{ run_id: PARENT, host_id: 'h_gone' }]);
    expect(stub.requests).toHaveLength(0);
  });

  it('[ac:ac-run-remote-z-fromrunid-i-jawnym-hoste] run_remote with fromRunId and an explicit host other than the parent\'s orders the Run on that host', async () => {
    await parentWithResult();
    const other = new RunsApiStub();
    try {
      fx.hosts.push(host('b', await other.listen(), { capabilities: CONTINUATION }));
      const result = await run(fx.deps(), { fromRunId: PARENT, host: 'b' });
      expect(result.host).toEqual({ id: 'b', name: 'name-b' });
      expect(stub.requests).toHaveLength(0);
      expect(other.requests).toHaveLength(1);
      expect(other.requests[0]!.authorization).toBe('Bearer c4sr_token_b');
      expect(other.requests[0]!.body.continuation).toEqual({ parentRunId: PARENT });
      expect(fx.rowsWithParent().find((r) => r.run_id === result.runId)).toEqual({ run_id: result.runId, host_id: 'h_b', parent_run_id: PARENT });
    } finally {
      await other.close();
    }
  });

  it('[ac:ac-run-remote-z-fromrunid-na-hoscie-bez] run_remote with fromRunId on a host without `run-continuation` in its capabilities ends with RUN_HOST_WITHOUT_CONTINUATION — the parent\'s host and an explicit one — with no row and no PUT', async () => {
    await parentWithResult();
    fx.hosts.length = 0;
    fx.hosts.push(host('a', url, { capabilities: ['runs'] }), host('b', url, { capabilities: ['runs'] }));
    for (const input of [{ fromRunId: PARENT }, { fromRunId: PARENT, host: 'b' }]) {
      const err = await refusal(run(fx.deps(), input));
      expect(err.code).toBe('RUN_HOST_WITHOUT_CONTINUATION');
    }
    expect(fx.rows()).toEqual([{ run_id: PARENT, host_id: 'h_a' }]);
    expect(stub.requests).toHaveLength(0);
    // The host conditions still come first: a host without `runs` keeps its own code.
    fx.hosts.length = 0;
    fx.hosts.push(host('a', url, { capabilities: ['run-continuation'] }));
    expect((await refusal(run(fx.deps(), { fromRunId: PARENT }))).code).toBe('RUN_HOST_WITHOUT_RUNS');
  });

  it('[ac:ac-run-remote-z-fromrunid-i-planpath-kon] run_remote with fromRunId and planPath ends with INVALID_ARGS — so do prompt and projectId with fromRunId — with no fetch, no row and no PUT', async () => {
    await parentWithResult();
    const fetch = vi.spyOn(fx.git, 'fetch');
    for (const input of [
      { fromRunId: PARENT, planPath: 'p1.md' },
      { fromRunId: PARENT, prompt: 'x' },
      { fromRunId: PARENT, projectId: 'app' },
    ]) {
      const err = await refusal(run(fx.deps(), input));
      expect(err.code).toBe('INVALID_ARGS');
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(fx.rows()).toEqual([{ run_id: PARENT, host_id: 'h_a' }]);
    expect(stub.requests).toHaveLength(0);
  });

  it('[ac:ac-run-remote-z-instruction-bez-fromruni] run_remote with instruction and no fromRunId ends with INVALID_ARGS, with no row and no PUT', async () => {
    for (const input of [{ instruction: 'do more' }, { instruction: 'do more', prompt: 'x' }, { instruction: 'do more', planPath: 'p1.md' }]) {
      const err = await refusal(run(fx.deps(), input));
      expect(err.code).toBe('INVALID_ARGS');
      expect(err.message).toContain('fromRunId');
    }
    expect(fx.rows()).toEqual([]);
    expect(stub.requests).toHaveLength(0);
  });

  it('[ac:ac-run-remote-z-fromrunid-nieznanym-mast] run_remote with a fromRunId unknown to the master ends with RUN_PARENT_NOT_FOUND — no row and no record, a runId off the pattern, and a Run of another workspace', async () => {
    expect((await refusal(run(fx.deps(), { fromRunId: '01jzzzzzzzzzzzzzzzzzzzzzzz' }))).code).toBe('RUN_PARENT_NOT_FOUND');
    expect((await refusal(run(fx.deps(), { fromRunId: '../../etc' }))).code).toBe('RUN_PARENT_NOT_FOUND');
    // A Run of another workspace in the same repository: its result ref exists, its record lies under another home.
    const foreign = '01jforeign0000000000000000';
    await fx.pushRunRecord(foreign, parentRecord({ runId: foreign }), { 'ws/app/pages/f.md': '# f\n' }, { home: 'other-ws' });
    const err = await refusal(run(fx.deps(), { fromRunId: foreign }));
    expect(err.code).toBe('RUN_PARENT_NOT_FOUND');
    expect(err.message).toContain(foreign);
    expect(stub.requests).toHaveLength(0);
  });

  it('[ac:ac-run-remote-z-fromrunid-runu-bez-refa] run_remote with fromRunId of a Run without a result ref ends with RUN_PARENT_WITHOUT_RESULT — also a parent still running', async () => {
    // Ordered from this workspace (row), still running: no ref on the remote yet.
    fx.registry.insert(PARENT, 'h_a');
    const err = await refusal(run(fx.deps(), { fromRunId: PARENT }));
    expect(err.code).toBe('RUN_PARENT_WITHOUT_RESULT');
    expect(await fx.git.shadowTip(`${PARENT}/work`)).toBeNull();
    expect(stub.requests).toHaveLength(0);
  });

  it('[ac:ac-run-remote-z-fromrunid-runu-z-wejscie] run_remote with fromRunId of a Run with a prompt input ends with RUN_PARENT_PROMPT_INPUT', async () => {
    await parentWithResult({ input: { kind: 'prompt', projectId: 'app' } });
    const err = await refusal(run(fx.deps(), { fromRunId: PARENT }));
    expect(err.code).toBe('RUN_PARENT_PROMPT_INPUT');
    expect(stub.requests).toHaveLength(0);
  });

  it('[ac:ac-run-remote-z-fromrunid-runu-ktorego-r] run_remote with fromRunId of a Run whose record has `reason` `recipe-modified` ends with RUN_PARENT_RECIPE_MODIFIED', async () => {
    await parentWithResult({ outcome: 'failed', reason: 'recipe-modified', handoff: undefined });
    const err = await refusal(run(fx.deps(), { fromRunId: PARENT }));
    expect(err.code).toBe('RUN_PARENT_RECIPE_MODIFIED');
    expect(stub.requests).toHaveLength(0);
  });

  it('[ac:ac-run-remote-z-fromrunid-runu-ktorego-c] run_remote with fromRunId of a Run whose shadow is superseded ends with RUN_PARENT_SUPERSEDED, naming the child', async () => {
    await parentWithResult();
    const CHILD = '01jchild0000000000000000ab';
    fx.registry.insert(CHILD, 'h_a', PARENT);
    await fx.pushRunRecord(CHILD, parentRecord({ runId: CHILD, parentRunId: PARENT, resultRef: `refs/runs/${CHILD}/work` }), {}, { base: PARENT });

    const err = await refusal(run(fx.deps(), { fromRunId: PARENT }));
    expect(err.code).toBe('RUN_PARENT_SUPERSEDED');
    expect(err.extra).toEqual({ supersededBy: [CHILD] });
    expect(stub.requests).toHaveLength(0);
    // The child — the end of the chain — can be continued.
    const next = await run(fx.deps(), { fromRunId: CHILD });
    expect(put().body.continuation).toEqual({ parentRunId: CHILD });
    expect(fx.registry.get(next.runId)?.parentRunId).toBe(CHILD);
  });

  it('[ac:ac-odmowa-run-parent-nie-zostawia-wpisu] a RUN_PARENT_* refusal leaves no row in the registry', async () => {
    // Parents of every refusal, each already in the registry (or not, for NOT_FOUND).
    const running = '01jrunning0000000000000000';
    fx.registry.insert(running, 'h_a');
    const prompt = '01jprompt00000000000000000';
    await parentWithResult({ input: { kind: 'prompt', projectId: 'app' } }, prompt);
    const recipe = '01jrecipe00000000000000000';
    await parentWithResult({ outcome: 'failed', reason: 'recipe-modified' }, recipe);
    await parentWithResult();
    const child = '01jchild0000000000000000cd';
    await fx.pushRunRecord(child, parentRecord({ runId: child, parentRunId: PARENT }), {}, { base: PARENT });
    const before = fx.rowsWithParent();

    const codes: string[] = [];
    for (const fromRunId of ['01jnobody00000000000000000', running, prompt, recipe, PARENT]) {
      codes.push((await refusal(run(fx.deps({ newRunId: () => '01jnewrun00000000000000000' }), { fromRunId }))).code);
    }
    expect(codes).toEqual([
      'RUN_PARENT_NOT_FOUND',
      'RUN_PARENT_WITHOUT_RESULT',
      'RUN_PARENT_PROMPT_INPUT',
      'RUN_PARENT_RECIPE_MODIFIED',
      'RUN_PARENT_SUPERSEDED',
    ]);
    expect(fx.rowsWithParent()).toEqual(before);
    expect(fx.registry.get('01jnewrun00000000000000000')).toBeNull();
    expect(stub.requests).toHaveLength(0);
  });

  it('[section:7bo43wak] a thread without a plan must name a plan path, a prompt or a parent Run: fromRunId alone is enough, nothing at all is INVALID_ARGS', async () => {
    await parentWithResult();
    const none = await refusal(run(fx.deps({ pinned: null }), {}));
    expect(none.code).toBe('INVALID_ARGS');
    expect(none.message).toContain('fromRunId');
    const result = await run(fx.deps({ pinned: null }), { fromRunId: PARENT });
    expect(put().url).toBe(`/runs/${result.runId}`);
    expect(put().body.input).toEqual({ kind: 'plan', projectId: 'app', path: 'p1.md' });
  });

  it('[entity:run-remote] a parent already accepted (its tip an ancestor of HEAD) is no refusal: the continuation starts from its result', async () => {
    const resultSha = await parentWithResult();
    await fx.acceptShadow(PARENT);
    await run(fx.deps(), { fromRunId: PARENT });
    expect(put().body.baseSha).toBe(resultSha);
    expect(put().body.continuation).toEqual({ parentRunId: PARENT });
  });

  it('[entity:run-remote] the plan of the parent\'s record missing at the base sha ends with PLAN_NOT_FOUND; a project of the record outside the workspace with RUN_PROJECT_NOT_FOUND — no row, no PUT', async () => {
    await parentWithResult({ input: { kind: 'plan', projectId: 'app', path: 'gone.md' } });
    expect((await refusal(run(fx.deps(), { fromRunId: PARENT }))).code).toBe('PLAN_NOT_FOUND');
    const other = '01jotherproject00000000000';
    await parentWithResult({ input: { kind: 'plan', projectId: 'ghost', path: 'p1.md' } }, other);
    expect((await refusal(run(fx.deps(), { fromRunId: other }))).code).toBe('RUN_PROJECT_NOT_FOUND');
    expect(fx.rows().map((r) => r.run_id).sort()).toEqual([PARENT, other].sort());
    expect(stub.requests).toHaveLength(0);
  });

  /** The parent's result ref brought into the local repository, as an earlier fetch would have left it. */
  const fetchParentRef = (id = PARENT) => git(['fetch', 'origin', `+refs/runs/${id}/work:refs/runs/${id}/work`], fx.repo);

  it('[ac:ac-kontynuacja-bez-upstreamu-konczy-sie] a continuation without an upstream of the current branch ends with RUN_NO_UPSTREAM — no row and no PUT', async () => {
    await parentWithResult();
    await fetchParentRef();
    await git(['branch', '--unset-upstream'], fx.repo);
    const err = await refusal(run(fx.deps(), { fromRunId: PARENT }));
    expect(err.code).toBe('RUN_NO_UPSTREAM');
    expect(fx.rows()).toEqual([{ run_id: PARENT, host_id: 'h_a' }]);
    expect(stub.requests).toHaveLength(0);
  });

  it('[ac:ac-kontynuacja-z-repo-spoza-repozytoriow] a continuation on another host whose gateway does not serve the order\'s `repo` ends with RUN_REJECTED carrying the field `repo`', async () => {
    await parentWithResult();
    const other = new RunsApiStub();
    try {
      fx.hosts.push(host('b', await other.listen(), { capabilities: CONTINUATION }));
      // Host b's gateway serves another repository only: the synchronous rejection names `repo`.
      const gatewayRepos = new Set(['https://github.com/acme/elsewhere.git']);
      other.reply = (req) =>
        gatewayRepos.has(req.body.repo as string)
          ? { status: 202, body: { runId: req.url.split('/').pop(), state: 'queued' } }
          : { status: 400, body: { code: 'invalid_request', message: "The repository is not on this host's allowed list.", field: 'repo' } };
      const err = await refusal(run(fx.deps({ newRunId: () => '01jrejected0000000000000000' }), { fromRunId: PARENT, host: 'b' }));
      expect(err.code).toBe('RUN_REJECTED');
      expect(err.extra).toEqual({ field: 'repo' });
      expect(other.requests).toHaveLength(1);
      // The order's `repo` is the cleared remote of the current branch's upstream.
      expect(other.requests[0]!.body.repo).toBe(fx.bare);
      expect(other.requests[0]!.body.continuation).toEqual({ parentRunId: PARENT });
      // The `4xx` deletes the continuation's row; the parent's stays.
      expect(fx.rows()).toEqual([{ run_id: PARENT, host_id: 'h_a' }]);
    } finally {
      await other.close();
    }
  });

  it('[section:fdu51xri] a failed fetch() is no refusal: the parent is recognized from the local refs and the continuation is ordered', async () => {
    const resultSha = await parentWithResult();
    await fetchParentRef();
    const fetch = vi.spyOn(fx.git, 'fetch').mockResolvedValue({ status: 'error', ahead: null, behind: null, message: 'network unreachable' });
    const result = await run(fx.deps(), { fromRunId: PARENT });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(put().body.baseSha).toBe(resultSha);
    expect(put().body.continuation).toEqual({ parentRunId: PARENT });
    expect(fx.registry.get(result.runId)?.parentRunId).toBe(PARENT);
  });

  it('[section:fdu51xri] a parent record without a readable project or plan path in its input ends with RUN_PARENT_WITHOUT_RESULT — before the prompt, recipe and supersession checks', async () => {
    const noPath = '01jnopath00000000000000000';
    await parentWithResult({ input: { kind: 'plan', projectId: 'app' } }, noPath);
    const noProject = '01jnoproject00000000000000';
    await parentWithResult({ input: { kind: 'plan', path: 'p1.md' } }, noProject);
    // Unreadable input and `recipe-modified`: the unreadable input is checked first.
    const both = '01jboth0000000000000000000';
    await parentWithResult({ input: { kind: 'plan', projectId: 7, path: 'p1.md' }, outcome: 'failed', reason: 'recipe-modified' }, both);
    const before = fx.rowsWithParent();
    for (const fromRunId of [noPath, noProject, both]) {
      const err = await refusal(run(fx.deps(), { fromRunId }));
      expect(err.code).toBe('RUN_PARENT_WITHOUT_RESULT');
    }
    expect(fx.rowsWithParent()).toEqual(before);
    expect(stub.requests).toHaveLength(0);
  });

  it('[section:fdu51xri] the parent\'s supersession is computed on demand: resolveShadow is asked with `supersession: true`', async () => {
    await parentWithResult();
    const resolve = vi.spyOn(fx.git, 'resolveShadow');
    await run(fx.deps(), { fromRunId: PARENT });
    expect(resolve).toHaveBeenCalledWith(`${PARENT}/work`, expect.anything(), { supersession: true });
    expect(put().body.continuation).toEqual({ parentRunId: PARENT });
  });

  it('[entity:run-remote] the version check and the trust read the base sha of the continuation (the parent\'s result)', async () => {
    // The parent's result pins a c4s lower than the definition's minimum; the upstream does not.
    fx.registry.insert(PARENT, 'h_a');
    await fx.pushRunRecord(PARENT, parentRecord(), {
      'ws/.c4s-runner/environment.json': JSON.stringify({ schemaVersion: 1, c4sVersion: '0.0.1' }),
    });
    const err = await refusal(run(fx.deps(), { fromRunId: PARENT }));
    expect(err.code).toBe('RUN_C4S_VERSION_INCOMPATIBLE');
    expect(stub.requests).toHaveLength(0);
  });
});
