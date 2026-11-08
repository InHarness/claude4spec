import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildRunToolsServer } from './run-tools.js';
import { runLocalConsentOf, TRUST_WARNING_PLUGINS, TRUST_WARNING_SKILL_USES, type RunRemoteDeps } from '../runs/run-remote.js';
import { runConsentNeedsOf } from '../runs/run-consent-needs.js';
import type { RunReadDeps } from '../runs/run-read.js';
import { RUN_READ_ERROR_CODES, RUN_REASON_HINTS } from '../runs/run-read.js';
import { RUN_ID_PATTERN } from '../runs/run-id.js';
import { CATALOG } from '../operations/catalog.js';
import { expectToolMatchesToolRecord, type WriteToolRecord } from '../../../tests/helpers/write-tool-records.js';
import { expectOperationMatchesRecord, type OperationRecord } from '../../../tests/helpers/operation-records.js';
import { host, makeRunRemoteFixture, RunsApiStub, write, type RunRemoteFixture } from '../../../tests/helpers/run-remote-fixture.js';

/** mcp-tools `run-tools-run-remote`, `run-tools-get-run` (2.1.69) and `run-tools-cancel-run`, verbatim. */
const RUN_TOOL_RECORDS: Record<string, WriteToolRecord> = {
  'run-tools-run-remote': {
    server: 'run-tools',
    name: 'run_remote',
    description:
      'Starts a Run on a runner host: an agent turn over the specification of the whole workspace, executed on a remote machine. Use it when the user asks to execute a plan (or a prompt) remotely (Remote execution), or when the user asks to continue a Run that did not finish its work. The call returns as soon as the host accepts the Run; it does not wait for the Run to finish. The result reaches the master only as a shadow that a human accepts in Releases → Shadows. Use get_run later to report its state.',
    params: [
      {
        name: 'planPath',
        type: 'string',
        required: false,
        description:
          'Path of the plan file, relative to the plans directory of the project. Omit to execute the plan attached to the current thread. Not together with `prompt`.',
      },
      { name: 'prompt', type: 'string', required: false, description: 'Free-form instruction to execute instead of a plan. Not together with `planPath`.' },
      {
        name: 'projectId',
        type: 'string',
        required: false,
        description:
          'Project the plan or the prompt belongs to. Defaults to the current project. With the plan attached to the thread it must be the current project.',
      },
      {
        name: 'fromRunId',
        type: 'string',
        required: false,
        description:
          'Id of a finished Run to continue; the new Run starts from its result and gets its handoff. Not together with `planPath`, `prompt` or `projectId`.',
      },
      { name: 'instruction', type: 'string', required: false, description: "What the continuation should do beyond the parent's plan. Only with `fromRunId`." },
      { name: 'agent', type: 'string', required: false, description: 'Name of the agent definition the Run executes.' },
      {
        name: 'host',
        type: 'string',
        required: false,
        description:
          "Local id of the runner host. Omit when exactly one connected host offers Runs; with several, the call is refused with the list of hosts to choose from. With `fromRunId`, omit to use the parent's host.",
      },
      { name: 'notes', type: 'string', required: false, description: "Notes for the Run's agent, passed through unchanged. Field rules: c4s-runner dto run-request." },
      {
        name: 'timeoutMinutes',
        type: 'number',
        required: false,
        description:
          'Run time limit in minutes. Omit to use the host default; pass it only when the user names a limit. The host enforces its own upper bound.',
      },
      { name: 'model', type: 'string', required: false, description: "Model the Run's agent uses. Omit for the host default. Field rules: c4s-runner dto run-request." },
    ],
    hints: { readOnlyHint: null, destructiveHint: null, idempotentHint: null, openWorldHint: true },
  },
  'run-tools-get-run': {
    server: 'run-tools',
    name: 'get_run',
    description:
      'Reports the state of a Run ordered earlier with run_remote: state, outcome, reason and the handoff when there is one — never logs. When the Run left a result, tells in which projects its shadow can be reviewed in Releases → Shadows, that the shadow is already accepted, or that it is superseded by a continuation. Use it when the user asks how a Run is doing.',
    params: [{ name: 'runId', type: 'string', required: true, description: 'Id returned by run_remote.' }],
    hints: { readOnlyHint: false, destructiveHint: null, idempotentHint: true, openWorldHint: true },
  },
  'run-tools-cancel-run': {
    server: 'run-tools',
    name: 'cancel_run',
    description:
      'Cancels a Run ordered earlier with run_remote. Use it only when the user asks to stop the Run. Cancelling a Run that has already finished changes nothing and reports the Run as it is.',
    params: [{ name: 'runId', type: 'string', required: true, description: 'Id returned by run_remote.' }],
    hints: { readOnlyHint: null, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
};

function connectTo(deps: RunRemoteDeps, readDeps: RunReadDeps, threadId: string | null = 't1') {
  const server = buildRunToolsServer({ deps, readDeps, threadId });
  return async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server };
  };
}

async function call(client: Client, args: Record<string, unknown>, name = 'run_remote') {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
  return { isError: res.isError === true, body: JSON.parse(text) as Record<string, unknown> };
}

describe('run-tools · run_remote (mcp-tool run-tools-run-remote)', () => {
  let fx: RunRemoteFixture;
  let stub: RunsApiStub;

  beforeEach(async () => {
    fx = await makeRunRemoteFixture();
    stub = new RunsApiStub();
    fx.hosts.push(host('a', await stub.listen()));
  });

  afterEach(async () => {
    await stub.close();
    fx.dispose();
  });

  it('[entity:run-tools-run-remote] lists run_remote with the record\'s name, description, parameters (all optional, `agent` defaulting to "plan-execution") and openWorldHint alone; master-computed fields are not parameters', async () => {
    const { client, server } = await connectTo(fx.deps(), fx.readDeps())();
    expect(server.tools.map((t) => t.name)).toEqual(['run_remote', 'get_run', 'cancel_run']);
    expectToolMatchesToolRecord(server.tools[0], RUN_TOOL_RECORDS['run-tools-run-remote']!);
    const listed = (await client.listTools()).tools;
    expect(listed.map((t) => t.name)).toEqual(['run_remote', 'get_run', 'cancel_run']);
    expect(listed[0]!.annotations).toEqual({ openWorldHint: true });
    const props = listed[0]!.inputSchema.properties as Record<string, { default?: unknown }>;
    expect(props.agent?.default).toBe('plan-execution');
    for (const computed of ['repo', 'home', 'baseSha']) expect(props).not.toHaveProperty(computed);
    // `projectId` is a parameter, but optional: the master computes it when it is not given.
    expect(props).toHaveProperty('projectId');
    expect(listed[0]!.inputSchema.required ?? []).toEqual([]);
  });

  it('[entity:run-tools-run-remote] returns { runId, host } once the host accepts, executing the plan attached to the thread', async () => {
    const { client } = await connectTo(fx.deps(), fx.readDeps())();
    const { isError, body } = await call(client, {});
    expect(isError).toBe(false);
    expect(body.runId).toMatch(RUN_ID_PATTERN);
    expect(body.host).toEqual({ id: 'a', name: 'name-a' });
    expect(stub.requests[0]!.body.input).toEqual({ kind: 'plan', projectId: 'app', path: 'p1.md' });
    expect(stub.requests[0]!.body.agent).toMatchObject({ name: 'plan-execution' });
  });

  it('[entity:run-tools-run-remote] planPath with prompt, and the plan attached to the thread with the projectId of another project, are refused with INVALID_ARGS', async () => {
    fx.addProject('docs');
    const { client } = await connectTo(fx.deps(), fx.readDeps())();
    const both = await call(client, { planPath: 'p1.md', prompt: 'x' });
    expect(both.isError).toBe(true);
    expect(both.body.code).toBe('INVALID_ARGS');
    const foreign = await call(client, { projectId: 'docs' });
    expect(foreign.isError).toBe(true);
    expect(foreign.body.code).toBe('INVALID_ARGS');
    expect(stub.requests).toHaveLength(0);
  });

  it('[entity:run-tools-run-remote] projectId is accepted with the plan attached to the thread when it is the current project', async () => {
    const { client } = await connectTo(fx.deps(), fx.readDeps())();
    const { isError } = await call(client, { projectId: 'app' });
    expect(isError).toBe(false);
    expect(stub.requests[0]!.body.input).toEqual({ kind: 'plan', projectId: 'app', path: 'p1.md' });
  });

  it('[entity:run-tools-run-remote] fromRunId and instruction pass to the operation: the order is a continuation of the parent; instruction without fromRunId is INVALID_ARGS', async () => {
    const PARENT = '01jparent0000000000000000p';
    const url = fx.hosts[0]!.url;
    fx.hosts.length = 0;
    fx.hosts.push(host('a', url, { capabilities: ['runs', 'run-continuation'] }));
    fx.registry.insert({ runId: PARENT, hostId: 'h_a' });
    const sha = await fx.pushRunRecord(PARENT, { runId: PARENT, hostId: 'h_a', outcome: 'partial', input: { kind: 'plan', projectId: 'app', path: 'p1.md' } }, {
      'ws/app/pages/run.md': '# by the parent\n',
    });
    const { client } = await connectTo(fx.deps(), fx.readDeps())();
    const ok = await call(client, { fromRunId: PARENT, instruction: 'finish it' });
    expect(ok.isError).toBe(false);
    expect(ok.body.host).toEqual({ id: 'a', name: 'name-a' });
    expect(stub.requests[0]!.body).toMatchObject({ baseSha: sha, continuation: { parentRunId: PARENT, instruction: 'finish it' } });
    const bad = await call(client, { instruction: 'finish it' });
    expect(bad.isError).toBe(true);
    expect(bad.body.code).toBe('INVALID_ARGS');
  });

  it('[entity:run-tools-run-remote] a refusal carries its remedy: the host list of RUN_HOST_REQUIRED, the field of RUN_REJECTED', async () => {
    fx.hosts.push(host('b', fx.hosts[0]!.url));
    const { client } = await connectTo(fx.deps(), fx.readDeps())();
    const several = await call(client, {});
    expect(several.body.code).toBe('RUN_HOST_REQUIRED');
    expect(several.body.hosts).toEqual([
      { id: 'a', name: 'name-a' },
      { id: 'b', name: 'name-b' },
    ]);

    stub.reply = () => ({ status: 400, body: { code: 'invalid_request', message: 'too long', field: 'timeoutMinutes' } });
    const rejected = await call(client, { host: 'a', timeoutMinutes: 100000 });
    expect(rejected.body.code).toBe('RUN_REJECTED');
    expect(rejected.body.field).toBe('timeoutMinutes');
  });
});

describe('run-tools · run_remote warnings (mcp-tool run-tools-run-remote, returns `warnings?`)', () => {
  let fx: RunRemoteFixture;
  let stub: RunsApiStub;

  beforeEach(async () => {
    fx = await makeRunRemoteFixture();
    stub = new RunsApiStub();
    fx.hosts.push(host('a', await stub.listen()));
  });

  afterEach(async () => {
    await stub.close();
    fx.dispose();
  });

  it('[ac:ac-zwrot-run-remote-dla-projektu-z-plugi] the return of run_remote for a project with plugins and no local consent carries a warning — the Run is still ordered, without trust', async () => {
    // A project plugin package in the repository, and no consent on this machine.
    write(fx.project, '.claude4spec/plugins/acme/package.json', '{"name":"acme"}');
    await fx.pushAll('project plugin');
    const deps = fx.deps({ localConsent: (id) => runLocalConsentOf({}, id), consentNeeds: () => runConsentNeedsOf(fx.project) });
    const { client } = await connectTo(deps, fx.readDeps())();
    const { isError, body } = await call(client, {});
    expect(isError).toBe(false);
    expect(body.runId).toMatch(RUN_ID_PATTERN);
    expect(body.host).toEqual({ id: 'a', name: 'name-a' });
    expect(body.warnings).toEqual([TRUST_WARNING_PLUGINS]);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]!.body).not.toHaveProperty('c4sTrust');
  });

  it('[ac:ac-zwrot-run-remote-przy-zgodzie-dla-inn] the return of run_remote with a local consent for another path carries exactly one warning — the path one — though the project also has plugins and skill uses', async () => {
    write(fx.project, '.claude4spec/plugins/acme/package.json', '{"name":"acme"}');
    await fx.pushAll('project plugin');
    // The consent was given under `old-app`; workspace.json at the base sha lists the project under `app`.
    const deps = fx.deps({
      localConsent: (id) => runLocalConsentOf({ app: { path: 'old-app', trustProjectPlugins: true, confirmedSkillUses: ['s1'] } }, id),
      consentNeeds: () => ({ plugins: true, skillUses: ['s1', 's2'] }),
    });
    const { client } = await connectTo(deps, fx.readDeps())();
    const { isError, body } = await call(client, {});
    expect(isError).toBe(false);
    expect(body.warnings).toHaveLength(1);
    const [warning] = body.warnings as string[];
    expect(warning).toContain("'old-app'");
    expect(warning).toContain("'app'");
    expect(warning).not.toContain(TRUST_WARNING_PLUGINS);
    expect(warning).not.toContain(TRUST_WARNING_SKILL_USES);
    expect(stub.requests[0]!.body).not.toHaveProperty('c4sTrust');
  });

  it('[entity:run-tools-run-remote] `warnings` (2.1.69 `returns`): without a consent, the plugins warning and the unconfirmed `skill.uses` names with their list — two distinct warnings', async () => {
    const deps = fx.deps({ localConsent: (id) => runLocalConsentOf({}, id), consentNeeds: () => ({ plugins: true, skillUses: ['s1', 's2'] }) });
    const { client } = await connectTo(deps, fx.readDeps())();
    const { isError, body } = await call(client, {});
    expect(isError).toBe(false);
    expect(body.warnings).toEqual([TRUST_WARNING_PLUGINS, `${TRUST_WARNING_SKILL_USES}: s1, s2`]);
    expect(TRUST_WARNING_PLUGINS).not.toBe(TRUST_WARNING_SKILL_USES);
  });

  it('[entity:run-tools-run-remote] returns { runId, host } without `warnings` when the trust went with the order', async () => {
    write(fx.project, '.claude4spec/plugins/acme/package.json', '{"name":"acme"}');
    await fx.pushAll('project plugin');
    const deps = fx.deps({
      localConsent: (id) => runLocalConsentOf({ app: { path: 'app', trustProjectPlugins: true } }, id),
      consentNeeds: () => runConsentNeedsOf(fx.project),
    });
    const { client } = await connectTo(deps, fx.readDeps())();
    const { isError, body } = await call(client, {});
    expect(isError).toBe(false);
    expect(body).not.toHaveProperty('warnings');
    expect(Object.keys(body).sort()).toEqual(['host', 'runId']);
    expect(stub.requests[0]!.body.c4sTrust).toEqual({ projects: { app: { path: 'app', trustProjectPlugins: true } } });
  });
});

describe('run-tools · get_run and cancel_run (mcp-tools run-tools-get-run, run-tools-cancel-run)', () => {
  const RUN = '01jb3k9x7q2m4n5p6r8s0t1v2w';
  let fx: RunRemoteFixture;
  let stub: RunsApiStub;

  beforeEach(async () => {
    fx = await makeRunRemoteFixture();
    stub = new RunsApiStub();
    fx.hosts.push(host('a', await stub.listen()));
  });

  afterEach(async () => {
    await stub.close();
    fx.dispose();
  });

  it('[entity:run-tools-get-run] lists get_run with the record\'s name, description, one required string `runId` and the hints readOnlyHint false, idempotentHint and openWorldHint true', async () => {
    const { client, server } = await connectTo(fx.deps(), fx.readDeps())();
    expectToolMatchesToolRecord(server.tools.find((t) => t.name === 'get_run'), RUN_TOOL_RECORDS['run-tools-get-run']!);
    const listed = (await client.listTools()).tools.find((t) => t.name === 'get_run')!;
    expect(listed.annotations).toEqual({ readOnlyHint: false, idempotentHint: true, openWorldHint: true });
    expect(listed.inputSchema.required).toEqual(['runId']);
    expect(Object.keys(listed.inputSchema.properties ?? {})).toEqual(['runId']);
  });

  it('[entity:run-tools-get-run] get_run returns the Run with its source and shadow; a refusal comes back as its code', async () => {
    fx.registry.insert({ runId: RUN, hostId: 'h_a' });
    stub.reply = () => ({ status: 200, body: { runId: RUN, hostId: 'h_a', state: 'queued', resultRef: `refs/runs/${RUN}/work`, logs: ['x'] } });
    const { client } = await connectTo(fx.deps(), fx.readDeps())();
    const ok = await call(client, { runId: RUN }, 'get_run');
    expect(ok.isError).toBe(false);
    expect(ok.body).toEqual({ runId: RUN, source: 'host', state: 'queued', resultRef: `refs/runs/${RUN}/work`, shadow: null, hint: null });
    const unknown = await call(client, { runId: '01jb3k9x7q2m4n5p6r8s0t1v2x' }, 'get_run');
    expect(unknown.isError).toBe(true);
    expect(unknown.body.code).toBe('RUN_UNKNOWN');
  });

  it('[entity:run-tools-get-run] get_run returns resultSha and parentRunId as the runner gives them (the record\'s `returns`), next to the shadow', async () => {
    const PARENT = '01jparent0000000000000000p';
    fx.registry.insert({ runId: RUN, hostId: 'h_a', parentRunId: PARENT });
    const sha = await fx.pushRunRecord(RUN, { runId: RUN, hostId: 'h_a', outcome: 'partial', parentRunId: PARENT, input: { kind: 'plan', projectId: 'app', path: 'p1.md' } }, {
      'ws/app/pages/run.md': '# by the Run\n',
    });
    stub.reply = () => ({
      status: 200,
      body: { runId: RUN, hostId: 'h_a', state: 'finished', outcome: 'partial', resultRef: `refs/runs/${RUN}/work`, resultSha: sha, parentRunId: PARENT },
    });
    const { client } = await connectTo(fx.deps(), fx.readDeps())();
    const res = await call(client, { runId: RUN }, 'get_run');
    expect(res.isError).toBe(false);
    expect(res.body).toMatchObject({ runId: RUN, source: 'host', resultSha: sha, parentRunId: PARENT });
    expect(res.body.shadow).toEqual({ id: `${RUN}/work`, accepted: false, projects: [{ projectId: 'app', visible: true }] });
  });

  /** A finished, failed Run whose runner answer carries `reason` (`c4s-runner` dto `run`). */
  async function getRunWithReason(reason: string) {
    fx.registry.insert({ runId: RUN, hostId: 'h_a' });
    stub.reply = () => ({
      status: 200,
      body: { runId: RUN, hostId: 'h_a', state: 'finished', outcome: 'failed', reason, resultRef: `refs/runs/${RUN}/work` },
    });
    const { client } = await connectTo(fx.deps(), fx.readDeps())();
    const res = await call(client, { runId: RUN }, 'get_run');
    expect(res.isError).toBe(false);
    return res.body;
  }

  it('[ac:ac-get-run-z-powodem-environment-failed] get_run with the reason `environment-failed` carries in `reasonHint` the hint to order the Run again with a new runId', async () => {
    const body = await getRunWithReason('environment-failed');
    expect(body.reason).toBe('environment-failed');
    expect(body.reasonHint).toBe(RUN_REASON_HINTS['environment-failed']);
    // The hint (M55 `361n2mqb`): a failure of the environment on the host, the cause in the Run's log, again with a new runId.
    expect(body.reasonHint).toMatch(/environment failed on the host/);
    expect(body.reasonHint).toMatch(/log with the host's operator/);
    expect(body.reasonHint).toMatch(/again with a new runId/);
  });

  it('[ac:ac-get-run-z-powodem-reserved-subject-ni] get_run with the reason `reserved-subject` carries in `reasonHint` the hint to fix the agent definition before ordering the Run again', async () => {
    const body = await getRunWithReason('reserved-subject');
    expect(body.reasonHint).toBe(RUN_REASON_HINTS['reserved-subject']);
    // The hint (M55 `361n2mqb`): the reserved subject left no result; fix the agent definition first, then again with a new runId.
    expect(body.reasonHint).toMatch(/subject reserved for the record commit/);
    expect(body.reasonHint).toMatch(/fix the agent definition before ordering the Run again/);
    expect(body.reasonHint).toMatch(/new runId/);
  });

  it('[ac:ac-get-run-z-powodem-reserved-subject-po] get_run with the reason `reserved-subject` gives the reason verbatim, not as the general outcome', async () => {
    const body = await getRunWithReason('reserved-subject');
    // Verbatim: the runner's value is in the answer (an unknown reason would be left out — the general outcome).
    expect(body.reason).toBe('reserved-subject');
    expect(body.outcome).toBe('failed');
    expect(body).toMatchObject({ runId: RUN, source: 'host', state: 'finished', outcome: 'failed', reason: 'reserved-subject' });
  });

  it('[entity:run-tools-get-run] get_run: a reason outside the table of `361n2mqb` goes without `reasonHint`, and a reason unknown to the master goes as the general outcome, without a hint', async () => {
    const other = await getRunWithReason('agent-failed');
    expect(other.reason).toBe('agent-failed');
    expect(other).not.toHaveProperty('reasonHint');
    stub.reply = () => ({
      status: 200,
      body: { runId: RUN, hostId: 'h_a', state: 'finished', outcome: 'failed', reason: 'quantum-flux', resultRef: `refs/runs/${RUN}/work` },
    });
    const { client } = await connectTo(fx.deps(), fx.readDeps())();
    const unknown = (await call(client, { runId: RUN }, 'get_run')).body;
    expect(unknown.outcome).toBe('failed');
    expect(unknown).not.toHaveProperty('reason');
    expect(unknown).not.toHaveProperty('reasonHint');
  });

  it('[entity:run-tools-cancel-run] lists cancel_run with the record\'s name, description, one required string `runId` and the hints destructiveHint, idempotentHint and openWorldHint true', async () => {
    const { client, server } = await connectTo(fx.deps(), fx.readDeps())();
    expectToolMatchesToolRecord(server.tools.find((t) => t.name === 'cancel_run'), RUN_TOOL_RECORDS['run-tools-cancel-run']!);
    const listed = (await client.listTools()).tools.find((t) => t.name === 'cancel_run')!;
    expect(listed.annotations).toEqual({ destructiveHint: true, idempotentHint: true, openWorldHint: true });
    expect(listed.inputSchema.required).toEqual(['runId']);
  });

  it('[entity:run-tools-cancel-run] cancel_run posts the cancel and returns the Run with its source; a finished Run comes back unchanged', async () => {
    fx.registry.insert({ runId: RUN, hostId: 'h_a' });
    const finished = { runId: RUN, hostId: 'h_a', state: 'finished', outcome: 'cancelled', resultRef: `refs/runs/${RUN}/work` };
    stub.reply = () => ({ status: 200, body: finished });
    const { client } = await connectTo(fx.deps(), fx.readDeps())();
    const res = await call(client, { runId: RUN }, 'cancel_run');
    expect(res.isError).toBe(false);
    expect(stub.requests[0]).toMatchObject({ method: 'POST', url: `/runs/${RUN}/cancel` });
    expect(res.body).toEqual({ runId: RUN, source: 'host', state: 'finished', outcome: 'cancelled', resultRef: `refs/runs/${RUN}/work` });
    stub.reply = () => ({ status: 401, body: { code: 'unauthenticated', message: 'bad token' } });
    expect((await call(client, { runId: RUN }, 'cancel_run')).body.code).toBe('RUN_HOST_UNAUTHENTICATED');
  });
});

const READ_ROW = (nazwa: 'get_run' | 'cancel_run', tool: string, rest: string): OperationRecord => ({
  nazwa,
  zasieg: 'workspace',
  mediacja: 'direct',
  channels: {
    internal: { kind: 'direct' },
    cli: { kind: 'na', reason: 'operacje Runu mają wyłącznie kanał agenta wątku czatu najwyższego poziomu, który Run zlecił' },
    mcp: { kind: 'na', reason: 'operacje Runu mają wyłącznie kanał agenta wątku czatu najwyższego poziomu, który Run zlecił' },
    rest: { kind: 'na', reason: rest },
  },
  efekty: ['db'],
  idempotencja: true,
  opisTresci: undefined,
  kodyBledow: [
    'RUN_UNKNOWN',
    'RUN_UNTRACEABLE',
    'RUN_HOST_WITHOUT_RUNS',
    'RUN_HOST_NOT_FOUND',
    'RUN_HOST_UNAUTHENTICATED',
    'RUN_HOST_ERROR',
    'RUN_HOST_UNREACHABLE',
    'GIT_UNAVAILABLE',
  ],
  narzedzia: { internal: [tool] },
});

describe('the catalog rows get_run and cancel_run (spec-operations get-run, cancel-run)', () => {
  it('[entity:get-run] get_run: workspace, direct, internal direct rendered by run-tools.get_run, cli/mcp/rest n/a with the record\'s reasons, effect db, idempotent, the record\'s 8 codes, rules error-code-once/echo-free/explicit-addressing', () => {
    const op = expectOperationMatchesRecord(
      READ_ROW('get_run', 'run-tools-get-run', 'moduł nie wnosi ekranu; stan Runu podaje agent na prośbę użytkownika'),
      RUN_TOOL_RECORDS,
    );
    expect(op.summary).toBe('Podaje zwięzły stan Runu zleconego wcześniej i drogę do jego cienia w Releases → Shadows.');
    expect(op.rules).toEqual([{ id: 'error-code-once' }, { id: 'echo-free' }, { id: 'explicit-addressing' }]);
    expect(Object.keys(op.inputSchema)).toEqual(['runId']);
    expect([...op.errorCodes]).toEqual([...RUN_READ_ERROR_CODES]);
  });

  it('[entity:cancel-run] cancel_run: workspace, direct, internal direct rendered by run-tools.cancel_run, cli/mcp/rest n/a with the record\'s reasons, effect db, idempotent, the record\'s 8 codes, rules error-code-once/echo-free/explicit-addressing', () => {
    const op = expectOperationMatchesRecord(
      READ_ROW('cancel_run', 'run-tools-cancel-run', 'moduł nie wnosi ekranu; anulowanie zleca agent na prośbę użytkownika'),
      RUN_TOOL_RECORDS,
    );
    expect(op.summary).toBe('Anuluje Run zlecony wcześniej; Run już zakończony wraca bez zmian.');
    expect(op.rules).toEqual([{ id: 'error-code-once' }, { id: 'echo-free' }, { id: 'explicit-addressing' }]);
    expect(Object.keys(op.inputSchema)).toEqual(['runId']);
  });
});

describe('the catalog row run_remote (spec-operation run-remote)', () => {
  it('[entity:run-remote] run_remote: workspace, agent-mediated, internal direct rendered by run-tools.run_remote, cli/mcp/rest n/a with the record\'s reasons, effect db, not idempotent, the record\'s 28 codes (RUN_PROJECT_NOT_FOUND, RUN_HOST_WITHOUT_CONTINUATION and the five RUN_PARENT_* in, RUN_HOST_GATEWAY_UNAVAILABLE out), rules error-code-once/echo-free/explicit-addressing', () => {
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'run_remote',
        zasieg: 'workspace',
        mediacja: 'agent-mediated',
        channels: {
          internal: { kind: 'direct' },
          cli: {
            kind: 'na',
            reason: 'Run zleca wyłącznie agent wątku czatu najwyższego poziomu; wiersz poleceń nie ma wątku ani planu przypiętego do wątku',
          },
          mcp: {
            kind: 'na',
            reason: 'Run zleca wyłącznie agent wątku czatu najwyższego poziomu; konsument zewnętrzny nie zleca pracy na cudzej maszynie',
          },
          rest: { kind: 'na', reason: 'Run zleca wyłącznie agent wątku czatu najwyższego poziomu; operacja nie ma trasy dla interfejsu' },
        },
        efekty: ['db'],
        idempotencja: false,
        opisTresci: undefined,
        kodyBledow: [
          'GIT_UNAVAILABLE',
          'RUN_WORKSPACE_WITHOUT_HOME',
          'RUN_PROJECT_OUTSIDE_HOME',
          'RUN_PROJECT_NOT_FOUND',
          'RUN_NO_HOST',
          'RUN_HOST_REQUIRED',
          'RUN_HOST_NOT_FOUND',
          'RUN_HOST_NOT_CONNECTED',
          'RUN_HOST_WITHOUT_RUNS',
          'RUN_HOST_WITHOUT_CONTINUATION',
          'RUN_PARENT_NOT_FOUND',
          'RUN_PARENT_WITHOUT_RESULT',
          'RUN_PARENT_PROMPT_INPUT',
          'RUN_PARENT_RECIPE_MODIFIED',
          'RUN_PARENT_SUPERSEDED',
          'RUN_AGENT_NOT_FOUND',
          'RUN_C4S_VERSION_INCOMPATIBLE',
          'INVALID_ARGS',
          'PLAN_NOT_FOUND',
          'RUN_NO_UPSTREAM',
          'RUN_PLAN_NOT_ON_UPSTREAM',
          'RUN_PUBLISH_FAILED',
          'RUN_GIT_BUSY',
          'RUN_REJECTED',
          'RUN_HOST_UNAUTHENTICATED',
          'RUN_HOST_ERROR',
          'RUN_HOST_UNREACHABLE',
          'RUN_INTERNAL',
        ],
        narzedzia: { internal: ['run-tools-run-remote'] },
      },
      RUN_TOOL_RECORDS,
    );
    expect(op.summary).toBe(
      "Zleca Run na hoście runnera — turę agenta nad specyfikacją całego workspace'u na zdalnej maszynie — i wraca, zanim Run się skończy.",
    );
    expect(op.rules).toEqual([{ id: 'error-code-once' }, { id: 'echo-free' }, { id: 'explicit-addressing' }]);
    // The row's input is the tool's wire contract.
    expect(Object.keys(op.inputSchema).sort()).toEqual(RUN_TOOL_RECORDS['run-tools-run-remote']!.params.map((p) => p.name).sort());
    expect(CATALOG.require('run_remote').opClass).toBe('turn');
  });
});

describe('job:M55 — ordering a Run from the chat and reporting it (through the run-tools server, the module\'s only channel)', () => {
  let fx: RunRemoteFixture;
  let stub: RunsApiStub;

  beforeEach(async () => {
    fx = await makeRunRemoteFixture();
    stub = new RunsApiStub();
    fx.hosts.push(host('a', await stub.listen()));
  });

  afterEach(async () => {
    await stub.close();
    fx.dispose();
  });

  it('[job:M55] the chat agent orders the thread\'s plan with run_remote (default definition "plan-execution"), gets the runId back before the Run ends, then reports its state with get_run and stops it with cancel_run', async () => {
    let runId = '';
    stub.reply = (req) => {
      if (req.method === 'PUT') return { status: 202, body: { runId: req.url.split('/').pop(), state: 'queued' } };
      if (req.method === 'GET') return { status: 200, body: { runId, hostId: 'h_a', state: 'running' } };
      return { status: 200, body: { runId, hostId: 'h_a', state: 'finished', outcome: 'cancelled', resultRef: `refs/runs/${runId}/work` } };
    };
    const { client } = await connectTo(fx.deps(), fx.readDeps())();

    // 1. Order: no parameter at all — the plan pinned to the thread, its project, the default agent.
    const ordered = await call(client, {});
    expect(ordered.isError).toBe(false);
    runId = ordered.body.runId as string;
    expect(runId).toMatch(RUN_ID_PATTERN);
    expect(ordered.body.host).toEqual({ id: 'a', name: 'name-a' });
    const order = stub.requests[0]!;
    expect(order).toMatchObject({ method: 'PUT', url: `/runs/${runId}` });
    expect(order.body.input).toEqual({ kind: 'plan', projectId: 'app', path: 'p1.md' });
    expect((order.body.agent as { name: string }).name).toBe('plan-execution');
    // The master remembers on which host the Run runs.
    expect(fx.rows()).toEqual([{ run_id: runId, host_id: 'h_a' }]);

    // 2. Later, on request: the state of the ordered Run, from its host.
    const state = await call(client, { runId }, 'get_run');
    expect(state.isError).toBe(false);
    expect(state.body).toMatchObject({ runId, source: 'host', state: 'running' });
    expect(stub.requests[1]).toMatchObject({ method: 'GET', url: `/runs/${runId}` });

    // 3. On request: stop it.
    const cancelled = await call(client, { runId }, 'cancel_run');
    expect(cancelled.isError).toBe(false);
    expect(stub.requests[2]).toMatchObject({ method: 'POST', url: `/runs/${runId}/cancel` });
    expect(cancelled.body).toMatchObject({ runId, state: 'finished', outcome: 'cancelled', resultRef: `refs/runs/${runId}/work` });
  });
});
