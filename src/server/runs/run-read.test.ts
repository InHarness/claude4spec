import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitService } from '../services/git.js';
import {
  cancelRun,
  FILTER_NO_RELEASE_CHANGE,
  getRun,
  PLAN_HINT,
  RUN_HOST_WITHOUT_RUNS_MESSAGE,
  RUN_REASON_HINTS,
  RUN_UNKNOWN_MESSAGE,
  RUN_UNTRACEABLE_MESSAGE,
  RunReadError,
  type RunReadDeps,
} from './run-read.js';
import {
  deadUrl,
  host,
  makeRunRemoteFixture,
  RunsApiStub,
  write,
  type RunnerReply,
  type RunRemoteFixture,
} from '../../../tests/helpers/run-remote-fixture.js';

/**
 * M55 `get_run` / `cancel_run` (spec-operations `get-run`, `cancel-run`) over a
 * real repository with a bare upstream, the real workspace DB and a local stub
 * of a runner's Runs API.
 */

const RUN = '01jb3k9x7q2m4n5p6r8s0t1v2w';
const HOST_ID = 'h_a';

/** `c4s-runner` dto `run`, finished. */
function runBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: RUN,
    hostId: HOST_ID,
    state: 'finished',
    outcome: 'done',
    createdAt: '2026-10-30T10:00:00Z',
    startedAt: '2026-10-30T10:00:02Z',
    finishedAt: '2026-10-30T10:41:05Z',
    deadline: '2026-10-30T11:30:02Z',
    repo: 'github.com/acme/workspace',
    home: 'ws',
    baseSha: '3f2a9c1e7b4d6f8a0c2e4b6d8f1a3c5e7b9d0f2a',
    input: { kind: 'plan', path: 'app/plans/p1.md' },
    resultRef: `refs/runs/${RUN}/work`,
    agent: { name: 'shadow', version: '1' },
    model: 'opus',
    timeoutMinutes: 90,
    handoff: { summary: 'Done.', decisions: ['d1'], conflicts: [], commits: ['abc'] },
    ...over,
  };
}

/** `c4s-runner` dto `run-record`. */
function record(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: RUN,
    hostId: 'h_from_record',
    runnerVersion: '0.3.0',
    contractVersion: 1,
    repo: 'github.com/acme/workspace',
    baseSha: '3f2a9c1e7b4d6f8a0c2e4b6d8f1a3c5e7b9d0f2a',
    resultRef: `refs/runs/${RUN}/work`,
    agent: { name: 'shadow', version: '1' },
    input: { kind: 'plan', path: 'app/plans/p1.md' },
    model: 'opus',
    startedAt: '2026-10-30T10:00:02Z',
    finishedAt: '2026-10-30T10:41:05Z',
    outcome: 'partial',
    handoff: { summary: 'Did 4 of 6.', decisions: [], conflicts: ['c1'], commits: [] },
    ...over,
  };
}

const apiError = (status: number, code: string, message = `runner: ${code}`): RunnerReply => ({ status, body: { code, message } });

async function refusal(p: Promise<unknown>): Promise<RunReadError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RunReadError);
  return err as RunReadError;
}

describe('get_run / cancel_run (spec-operations get-run, cancel-run)', () => {
  let fx: RunRemoteFixture;
  let stub: RunsApiStub;
  let deps: RunReadDeps;

  beforeEach(async () => {
    fx = await makeRunRemoteFixture();
    stub = new RunsApiStub();
    fx.hosts.push(host('a', await stub.listen()));
    deps = fx.readDeps();
  });

  afterEach(async () => {
    await stub.close();
    fx.dispose();
  });

  const register = () => fx.registry.insert(RUN, HOST_ID);

  describe('the host answers', () => {
    it('[ac:ac-get-run-nie-zwraca-logow] get_run carries state, outcome, reason, handoff and resultRef from the host — no logs and no other runner field', async () => {
      register();
      stub.reply = () => ({ status: 200, body: runBody({ logs: ['line 1', 'line 2'], log: 'tail', stdout: 'x' }) });
      const result = await getRun(deps, { runId: RUN });
      expect(stub.requests[0]).toMatchObject({ method: 'GET', url: `/runs/${RUN}`, authorization: 'Bearer c4sr_token_a' });
      expect(Object.keys(result).sort()).toEqual(['handoff', 'hint', 'outcome', 'resultRef', 'runId', 'shadow', 'source', 'state']);
      expect(result).toMatchObject({ runId: RUN, source: 'host', state: 'finished', outcome: 'done', resultRef: `refs/runs/${RUN}/work` });
      expect(result.handoff).toEqual({ summary: 'Done.', decisions: ['d1'], conflicts: [], commits: ['abc'] });
      expect(JSON.stringify(result)).not.toMatch(/line 1|tail|stdout|logs/);
    });

    it('[ac:ac-get-run-odczytuje-cien-tylko-przy-obe] without resultSha get_run neither fetches nor lists shadows (shadow: null); with resultSha it fetches and reports per project where the shadow is visible or which filter rejected it', async () => {
      register();
      const fetchSpy = vi.spyOn(fx.git, 'fetch');
      const listSpy = vi.spyOn(fx.git, 'listShadows');

      stub.reply = () => ({ status: 200, body: runBody({ state: 'running', outcome: undefined, handoff: undefined }) });
      const running = await getRun(deps, { runId: RUN });
      expect(running.shadow).toBeNull();
      expect(running.state).toBe('running');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(listSpy).not.toHaveBeenCalled();

      // A second project of the workspace, whose release roots the Run does not touch.
      const docs = path.join(fx.home, 'docs');
      write(docs, '.claude4spec/config.json', JSON.stringify({ $schemaVersion: 4, name: 'docs', roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }], git: { enabled: true } }));
      write(docs, 'pages/index.md', '# docs\n');
      await fx.pushAll('docs project');
      const docsGit = new GitService(docs, [path.join(docs, 'pages')]);
      const sha = await fx.pushRunRecord(RUN, record(), { 'ws/app/pages/run.md': '# by the Run\n' });
      stub.reply = () => ({ status: 200, body: runBody({ resultSha: sha }) });
      const withResult = await getRun(
        { ...deps, projects: () => [{ projectId: 'app', git: fx.git }, { projectId: 'docs', git: docsGit }] },
        { runId: RUN },
      );
      expect(fetchSpy).toHaveBeenCalled();
      expect(withResult.shadow).toEqual({
        id: `${RUN}/work`,
        accepted: false,
        projects: [
          { projectId: 'app', visible: true },
          { projectId: 'docs', visible: false, filter: FILTER_NO_RELEASE_CHANGE },
        ],
      });
      expect(withResult.hint).toBeNull();
    });

    it('[ac:ac-get-run-przy-przyjetym-cieniu-podaje] get_run with the shadow\'s tip an ancestor of HEAD reports the shadow as accepted (and, at outcome done, hints at marking the plan)', async () => {
      register();
      const sha = await fx.pushRunRecord(RUN, record({ outcome: 'done' }), { 'ws/app/pages/run.md': '# by the Run\n' });
      await fx.acceptShadow(RUN);
      stub.reply = () => ({ status: 200, body: runBody({ resultSha: sha }) });
      const result = await getRun(deps, { runId: RUN });
      expect(result.shadow).toEqual({ id: `${RUN}/work`, accepted: true, projects: [] });
      expect(result.hint).toBe(PLAN_HINT);
    });

    it('[ac:ac-get-run-z-nieznanym-powodem-podaje-og] get_run with a reason this master does not know reports the general outcome, without the reason', async () => {
      register();
      stub.reply = () => ({ status: 200, body: runBody({ outcome: 'failed', reason: 'quantum-flux', handoff: undefined }) });
      const result = await getRun(deps, { runId: RUN });
      expect(result.outcome).toBe('failed');
      expect(result).not.toHaveProperty('reason');
      stub.reply = () => ({ status: 200, body: runBody({ outcome: 'aborted', reason: 'timeout', handoff: undefined }) });
      expect((await getRun(deps, { runId: RUN })).reason).toBe('timeout');
    });

    it('[ac:ac-odczyt-runu-zakonczonego-powodem-trus] reading a Run finished with `trust-path-mismatch` gives the reason verbatim together with the hint to approve again', async () => {
      register();
      stub.reply = () => ({ status: 200, body: runBody({ outcome: 'failed', reason: 'trust-path-mismatch', handoff: undefined }) });
      const result = await getRun(deps, { runId: RUN });
      expect(result.outcome).toBe('failed');
      // Verbatim: the runner's value, not rewritten.
      expect(result.reason).toBe('trust-path-mismatch');
      // And the master's hint next to it: approve the current path, then a new Run with a new runId.
      expect(result.reasonHint).toBe(RUN_REASON_HINTS['trust-path-mismatch']);
      expect(result.reasonHint).toMatch(/approve the current path/);
      expect(result.reasonHint).toMatch(/new runId/);

      // The same from the Run record in git (the runner no longer knows the Run).
      stub.reply = () => apiError(404, 'run_not_found');
      await fx.pushRunRecord(RUN, record({ outcome: 'failed', reason: 'trust-path-mismatch', handoff: undefined }));
      const fromRecord = await getRun(deps, { runId: RUN });
      expect(fromRecord).toMatchObject({ source: 'record', reason: 'trust-path-mismatch', reasonHint: RUN_REASON_HINTS['trust-path-mismatch'] });
    });

    it('[entity:get-run] the hint goes only with a reason of the table: `c4s-failed` gets its own, any other reason (known or not) none', async () => {
      register();
      stub.reply = () => ({ status: 200, body: runBody({ outcome: 'failed', reason: 'c4s-failed', handoff: undefined }) });
      const c4s = await getRun(deps, { runId: RUN });
      expect(c4s.reason).toBe('c4s-failed');
      expect(c4s.reasonHint).toBe(RUN_REASON_HINTS['c4s-failed']);
      expect(c4s.reasonHint).toMatch(/c4sVersion/);

      stub.reply = () => ({ status: 200, body: runBody({ outcome: 'failed', reason: 'agent-failed', handoff: undefined }) });
      const other = await getRun(deps, { runId: RUN });
      expect(other.reason).toBe('agent-failed');
      expect(other).not.toHaveProperty('reasonHint');

      stub.reply = () => ({ status: 200, body: runBody({ outcome: 'failed', reason: 'quantum-flux', handoff: undefined }) });
      const unknown = await getRun(deps, { runId: RUN });
      expect(unknown).not.toHaveProperty('reason');
      expect(unknown).not.toHaveProperty('reasonHint');
    });

    it('[ac:ac-get-run-ze-stanem-nieznanym-masterowi] get_run with a state this master does not know reports that state verbatim, marked as unknown to the master, and still reads the shadow by resultSha alone', async () => {
      register();
      // A known state carries no marker.
      stub.reply = () => ({ status: 200, body: runBody({ state: 'running', outcome: undefined, handoff: undefined }) });
      const known = await getRun(deps, { runId: RUN });
      expect(known.state).toBe('running');
      expect(known).not.toHaveProperty('stateUnknown');

      // Unknown state, no resultSha: verbatim, marked, the shadow is not read — the same path as any state.
      const listSpy = vi.spyOn(fx.git, 'listShadows');
      stub.reply = () => ({ status: 200, body: runBody({ state: 'suspended-by-operator', outcome: undefined, handoff: undefined }) });
      const bare = await getRun(deps, { runId: RUN });
      expect(bare).toMatchObject({ runId: RUN, source: 'host', state: 'suspended-by-operator', stateUnknown: true, shadow: null, hint: null });
      expect(listSpy).not.toHaveBeenCalled();

      // Unknown state with resultSha: still verbatim and marked, and the shadow is read as for any state.
      const sha = await fx.pushRunRecord(RUN, record(), { 'ws/app/pages/run.md': '# by the Run\n' });
      stub.reply = () => ({ status: 200, body: runBody({ state: 'archived', resultSha: sha }) });
      const withResult = await getRun(deps, { runId: RUN });
      expect(withResult.state).toBe('archived');
      expect(withResult.stateUnknown).toBe(true);
      expect(withResult.outcome).toBe('done');
      expect(withResult.shadow).toEqual({ id: `${RUN}/work`, accepted: false, projects: [{ projectId: 'app', visible: true }] });
    });

    it('[ac:ac-cancel-run-runu-zakonczonego-zwraca-g]cancel_run of a finished Run returns it unchanged — a repeat too', async () => {
      register();
      stub.reply = () => ({ status: 200, body: runBody({ outcome: 'done' }) });
      const first = await cancelRun(deps, { runId: RUN });
      const again = await cancelRun(deps, { runId: RUN });
      expect(stub.requests.map((r) => `${r.method} ${r.url}`)).toEqual([`POST /runs/${RUN}/cancel`, `POST /runs/${RUN}/cancel`]);
      expect(first).toEqual({
        runId: RUN,
        source: 'host',
        state: 'finished',
        outcome: 'done',
        handoff: { summary: 'Done.', decisions: ['d1'], conflicts: [], commits: ['abc'] },
        resultRef: `refs/runs/${RUN}/work`,
      });
      expect(again).toEqual(first);
    });

    it('[entity:cancel-run] cancel_run of a running Run returns the host\'s current Run (202)', async () => {
      register();
      stub.reply = () => ({ status: 202, body: runBody({ state: 'running', outcome: undefined, handoff: undefined }) });
      expect(await cancelRun(deps, { runId: RUN })).toEqual({ runId: RUN, source: 'host', state: 'running', resultRef: `refs/runs/${RUN}/work` });
    });
  });

  describe('the shared response mapping (veec5qxa)', () => {
    it('[ac:ac-nieznany-code-bledu-runnera-konczy-si] an unknown runner error code ends get_run and cancel_run with RUN_HOST_ERROR (and `internal` too)', async () => {
      register();
      stub.reply = () => apiError(418, 'brand_new_code');
      expect((await refusal(getRun(deps, { runId: RUN }))).code).toBe('RUN_HOST_ERROR');
      expect((await refusal(cancelRun(deps, { runId: RUN }))).code).toBe('RUN_HOST_ERROR');
      stub.reply = () => apiError(500, 'internal');
      expect((await refusal(getRun(deps, { runId: RUN }))).code).toBe('RUN_HOST_ERROR');
    });

    it('[ac:ac-odpowiedz-401-runnera-konczy-sie-run] a 401 unauthenticated ends get_run and cancel_run with RUN_HOST_UNAUTHENTICATED', async () => {
      register();
      stub.reply = () => apiError(401, 'unauthenticated');
      expect((await refusal(getRun(deps, { runId: RUN }))).code).toBe('RUN_HOST_UNAUTHENTICATED');
      expect((await refusal(cancelRun(deps, { runId: RUN }))).code).toBe('RUN_HOST_UNAUTHENTICATED');
    });

    it('[entity:get-run] no connection is RUN_HOST_UNREACHABLE; no host record with the registered hostId is RUN_HOST_NOT_FOUND', async () => {
      register();
      fx.hosts[0]!.url = await deadUrl();
      expect((await refusal(getRun(deps, { runId: RUN }))).code).toBe('RUN_HOST_UNREACHABLE');
      expect((await refusal(cancelRun(deps, { runId: RUN }))).code).toBe('RUN_HOST_UNREACHABLE');
      fx.hosts[0]!.hostId = 'h_other';
      expect((await refusal(getRun(deps, { runId: RUN }))).code).toBe('RUN_HOST_NOT_FOUND');
      expect((await refusal(cancelRun(deps, { runId: RUN }))).code).toBe('RUN_HOST_NOT_FOUND');
    });
  });

  describe('the path to the record in git (g9939pj0)', () => {
    it('[ac:ac-get-run-przy-run-not-found-z-rekordem] get_run after run_not_found answers from the record left in git', async () => {
      register();
      await fx.pushRunRecord(RUN, record(), { 'ws/app/pages/run.md': '# by the Run\n' });
      stub.reply = () => apiError(404, 'run_not_found');
      const result = await getRun(deps, { runId: RUN });
      expect(result).toMatchObject({
        runId: RUN,
        source: 'record',
        state: 'finished',
        outcome: 'partial',
        handoff: { summary: 'Did 4 of 6.', decisions: [], conflicts: ['c1'], commits: [] },
        resultRef: `refs/runs/${RUN}/work`,
      });
      expect(result.shadow).toEqual({ id: `${RUN}/work`, accepted: false, projects: [{ projectId: 'app', visible: true }] });
    });

    it('[ac:ac-get-run-przy-run-not-found-bez-rekord] get_run after run_not_found without a record refuses RUN_UNTRACEABLE, saying a missing record does not mean the Run never was', async () => {
      register();
      stub.reply = () => apiError(404, 'run_not_found');
      const err = await refusal(getRun(deps, { runId: RUN }));
      expect(err.code).toBe('RUN_UNTRACEABLE');
      expect(err.message).toBe(RUN_UNTRACEABLE_MESSAGE);
    });

    it('[ac:ac-get-run-przy-404-not-found-z-rekordem] get_run after 404 not_found (a host without runs) answers from the record left in git', async () => {
      register();
      await fx.pushRunRecord(RUN, record({ outcome: 'done', handoff: undefined }));
      stub.reply = () => apiError(404, 'not_found');
      const result = await getRun(deps, { runId: RUN });
      expect(result).toMatchObject({ source: 'record', state: 'finished', outcome: 'done' });
    });

    it('[ac:ac-get-run-przy-404-not-found-bez-rekord] get_run after 404 not_found without a record refuses RUN_HOST_WITHOUT_RUNS', async () => {
      register();
      stub.reply = () => apiError(404, 'not_found');
      const err = await refusal(getRun(deps, { runId: RUN }));
      expect(err.code).toBe('RUN_HOST_WITHOUT_RUNS');
      expect(err.message).toBe(RUN_HOST_WITHOUT_RUNS_MESSAGE);
    });

    it('[ac:ac-get-run-bez-wpisu-rejestru-i-bez-reko] get_run without a registry row and without a record refuses RUN_UNKNOWN, asking no host', async () => {
      const err = await refusal(getRun(deps, { runId: RUN }));
      expect(err.code).toBe('RUN_UNKNOWN');
      expect(err.message).toBe(RUN_UNKNOWN_MESSAGE);
      expect(stub.requests).toHaveLength(0);
    });

    it('[entity:get-run] without a registry row but with a record, get_run answers from it and restores the row from the record\'s hostId', async () => {
      await fx.pushRunRecord(RUN, record());
      const result = await getRun(deps, { runId: RUN });
      expect(result.source).toBe('record');
      expect(stub.requests).toHaveLength(0);
      expect(fx.rows()).toEqual([{ run_id: RUN, host_id: 'h_from_record' }]);
    });

    it('[entity:get-run] after the acceptance, with the result ref gone, the record is read from HEAD and the shadow is reported accepted', async () => {
      register();
      await fx.pushRunRecord(RUN, record({ outcome: 'done', handoff: undefined }), { 'ws/app/pages/run.md': '# by the Run\n' });
      await fx.acceptShadow(RUN);
      // Retention on the host: the ref is gone from the remote, and `fetch()` prunes it locally.
      const { execFileSync } = await import('node:child_process');
      execFileSync('git', ['push', 'origin', '--delete', `refs/runs/${RUN}/work`], { cwd: fx.repo, stdio: 'ignore' });
      stub.reply = () => apiError(404, 'run_not_found');
      const result = await getRun(deps, { runId: RUN });
      expect(result).toMatchObject({ source: 'record', outcome: 'done', shadow: { id: `${RUN}/work`, accepted: true, projects: [] }, hint: PLAN_HINT });
    });

    it('[ac:ac-cancel-run-przy-run-not-found-z-rekor] cancel_run after run_not_found answers from the record: the Run is finished and stays unchanged; the row is kept', async () => {
      register();
      await fx.pushRunRecord(RUN, record());
      stub.reply = () => apiError(404, 'run_not_found');
      const result = await cancelRun(deps, { runId: RUN });
      expect(result).toEqual({
        runId: RUN,
        source: 'record',
        state: 'finished',
        outcome: 'partial',
        handoff: { summary: 'Did 4 of 6.', decisions: [], conflicts: ['c1'], commits: [] },
        resultRef: `refs/runs/${RUN}/work`,
      });
      expect(fx.rows()).toEqual([{ run_id: RUN, host_id: HOST_ID }]);
    });

    it('[ac:ac-cancel-run-przy-run-not-found-bez-rek] cancel_run after run_not_found without a record refuses RUN_UNTRACEABLE', async () => {
      register();
      stub.reply = () => apiError(404, 'run_not_found');
      const err = await refusal(cancelRun(deps, { runId: RUN }));
      expect(err.code).toBe('RUN_UNTRACEABLE');
      expect(err.message).toBe(RUN_UNTRACEABLE_MESSAGE);
    });

    it('[ac:ac-cancel-run-przy-404-not-found-bez-rek] cancel_run after 404 not_found without a record refuses RUN_HOST_WITHOUT_RUNS', async () => {
      register();
      stub.reply = () => apiError(404, 'not_found');
      expect((await refusal(cancelRun(deps, { runId: RUN }))).code).toBe('RUN_HOST_WITHOUT_RUNS');
    });

    it('[entity:cancel-run] cancel_run without a registry row: from the record (row restored), else RUN_UNKNOWN', async () => {
      expect((await refusal(cancelRun(deps, { runId: RUN }))).code).toBe('RUN_UNKNOWN');
      await fx.pushRunRecord(RUN, record());
      expect((await cancelRun(deps, { runId: RUN })).source).toBe('record');
      expect(fx.rows()).toEqual([{ run_id: RUN, host_id: 'h_from_record' }]);
      expect(stub.requests).toHaveLength(0);
    });

    it('[ac:ac-odpowiedz-z-rekordu-bez-handoffu-poda] an answer from a record without a handoff gives the record\'s outcome and reason (get_run and cancel_run)', async () => {
      register();
      await fx.pushRunRecord(RUN, record({ outcome: 'failed', reason: 'no-handoff', handoff: undefined }));
      stub.reply = () => apiError(404, 'run_not_found');
      const read = await getRun(deps, { runId: RUN });
      expect(read).toMatchObject({ source: 'record', outcome: 'failed', reason: 'no-handoff' });
      expect(read).not.toHaveProperty('handoff');
      const cancelled = await cancelRun(deps, { runId: RUN });
      expect(cancelled).toEqual({ runId: RUN, source: 'record', state: 'finished', outcome: 'failed', reason: 'no-handoff', resultRef: `refs/runs/${RUN}/work` });
    });

    it('[entity:get-run] git unavailable on the record path refuses GIT_UNAVAILABLE rather than claiming the Run is unknown', async () => {
      const off = await makeRunRemoteFixture({ gitEnabled: false });
      try {
        expect((await refusal(getRun(off.readDeps(), { runId: RUN }))).code).toBe('GIT_UNAVAILABLE');
        expect((await refusal(cancelRun(off.readDeps(), { runId: RUN }))).code).toBe('GIT_UNAVAILABLE');
      } finally {
        off.dispose();
      }
    });
  });
  describe('continuation Runs (2.1.68: resultSha, parentRunId, supersededBy, parent reasons)', () => {
    const PARENT = '01jparent0000000000000000p';
    const CHILD = '01jchild00000000000000000c';

    it('[ac:ac-get-run-runu-z-resultsha-podaje-resul] get_run of a Run with resultSha gives resultSha, verbatim; without it the field is absent', async () => {
      register();
      const sha = await fx.pushRunRecord(RUN, record(), { 'ws/app/pages/run.md': '# by the Run\n' });
      stub.reply = () => ({ status: 200, body: runBody({ resultSha: sha }) });
      const result = await getRun(deps, { runId: RUN });
      expect(result.resultSha).toBe(sha);
      expect(result.shadow?.id).toBe(`${RUN}/work`);

      stub.reply = () => ({ status: 200, body: runBody({ state: 'running', outcome: undefined, handoff: undefined }) });
      expect(await getRun(deps, { runId: RUN })).not.toHaveProperty('resultSha');
    });

    it('[ac:ac-get-run-runu-kontynuacji-podaje-paren] get_run of a continuation Run gives parentRunId — from the host and from the record — and a row restored from the record keeps the parent', async () => {
      register();
      stub.reply = () => ({ status: 200, body: runBody({ state: 'queued', outcome: undefined, handoff: undefined, parentRunId: PARENT }) });
      const fromHost = await getRun(deps, { runId: RUN });
      expect(fromHost.parentRunId).toBe(PARENT);
      expect(fromHost.source).toBe('host');

      // A Run without a parent has no parentRunId.
      stub.reply = () => ({ status: 200, body: runBody({ state: 'queued', outcome: undefined, handoff: undefined }) });
      expect(await getRun(deps, { runId: RUN })).not.toHaveProperty('parentRunId');

      // From the record, with no registry row: the answer and the restored row carry the parent.
      fx.registry.delete(RUN);
      await fx.pushRunRecord(RUN, record({ parentRunId: PARENT }), { 'ws/app/pages/run.md': '# by the Run\n' });
      const fromRecord = await getRun(deps, { runId: RUN });
      expect(fromRecord).toMatchObject({ source: 'record', parentRunId: PARENT });
      expect(fx.registry.get(RUN)).toMatchObject({ hostId: 'h_from_record', parentRunId: PARENT });
    });

    it('[ac:ac-get-run-runu-ktorego-cien-ma-dziecko] get_run of a Run whose shadow has a child gives supersededBy with the child\'s runId — and no plan hint', async () => {
      fx.registry.insert(PARENT, HOST_ID);
      const parentSha = await fx.pushRunRecord(
        PARENT,
        record({ runId: PARENT, outcome: 'done', resultRef: `refs/runs/${PARENT}/work` }),
        { 'ws/app/pages/parent.md': '# by the parent\n' },
      );
      const childSha = await fx.pushRunRecord(
        CHILD,
        record({ runId: CHILD, parentRunId: PARENT, resultRef: `refs/runs/${CHILD}/work` }),
        { 'ws/app/pages/child.md': '# by the child\n' },
        { base: PARENT },
      );
      stub.reply = () => ({
        status: 200,
        body: runBody({ runId: PARENT, outcome: 'done', resultSha: parentSha, resultRef: `refs/runs/${PARENT}/work` }),
      });
      const result = await getRun(deps, { runId: PARENT });
      expect(result.shadow).toEqual({
        id: `${PARENT}/work`,
        accepted: false,
        projects: [{ projectId: 'app', visible: true }],
        supersededBy: [CHILD],
      });
      expect(result.hint).toBeNull();

      // The child — the end of the chain — is not superseded.
      fx.registry.insert(CHILD, HOST_ID, PARENT);
      stub.reply = () => ({ status: 200, body: runBody({ runId: CHILD, parentRunId: PARENT, resultSha: childSha, resultRef: `refs/runs/${CHILD}/work` }) });
      const child = await getRun(deps, { runId: CHILD });
      expect(child.parentRunId).toBe(PARENT);
      expect(child.shadow).toEqual({ id: `${CHILD}/work`, accepted: false, projects: [{ projectId: 'app', visible: true }] });
    });

    it('[ac:ac-odczyt-runu-zakonczonego-powodem-pare] reading a Run finished with `parent-not-found` gives the reason verbatim together with the hint', async () => {
      register();
      stub.reply = () => ({ status: 200, body: runBody({ outcome: 'failed', reason: 'parent-not-found', handoff: undefined, parentRunId: PARENT }) });
      const result = await getRun(deps, { runId: RUN });
      expect(result.outcome).toBe('failed');
      // Verbatim: the runner's value, not rewritten and not dropped as unknown.
      expect(result.reason).toBe('parent-not-found');
      // And the master's hint next to it: a new Run from the upstream, or a continuation of another Run of the chain.
      expect(result.reasonHint).toBe(RUN_REASON_HINTS['parent-not-found']);
      expect(result.reasonHint).toMatch(/new Run from the upstream/);
      expect(result.reasonHint).toMatch(/another Run of the chain/);
    });

    it('[entity:get-run] the other parent reasons go verbatim with their hints: parent-mismatch (again, with a new runId) and parent-recipe-modified (a new Run from the upstream)', async () => {
      register();
      for (const reason of ['parent-mismatch', 'parent-recipe-modified']) {
        stub.reply = () => ({ status: 200, body: runBody({ outcome: 'failed', reason, handoff: undefined }) });
        const result = await getRun(deps, { runId: RUN });
        expect(result.reason).toBe(reason);
        expect(result.reasonHint).toBe(RUN_REASON_HINTS[reason]);
      }
      expect(RUN_REASON_HINTS['parent-mismatch']).toMatch(/new runId/);
      expect(RUN_REASON_HINTS['parent-recipe-modified']).toMatch(/new Run from the upstream/);
    });
  });
});
