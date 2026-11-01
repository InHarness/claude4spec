import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildRunToolsServer } from './run-tools.js';
import type { RunRemoteDeps } from '../runs/run-remote.js';
import type { RunReadDeps } from '../runs/run-read.js';
import { RUN_READ_ERROR_CODES } from '../runs/run-read.js';
import { RUN_ID_PATTERN } from '../runs/run-id.js';
import { CATALOG } from '../operations/catalog.js';
import { expectToolMatchesToolRecord, type WriteToolRecord } from '../../../tests/helpers/write-tool-records.js';
import { expectOperationMatchesRecord, type OperationRecord } from '../../../tests/helpers/operation-records.js';
import { host, makeRunRemoteFixture, RunsApiStub, type RunRemoteFixture } from '../../../tests/helpers/run-remote-fixture.js';

/** mcp-tool `run-tools-run-remote` (2.1.64), verbatim. */
const RUN_TOOL_RECORDS: Record<string, WriteToolRecord> = {
  'run-tools-run-remote': {
    server: 'run-tools',
    name: 'run_remote',
    description:
      'Starts a Run on a runner host: an agent turn over the specification of the whole workspace, executed on a remote machine. Use it when the user asks to execute a plan (or a prompt) in shadow mode. The call returns as soon as the host accepts the Run; it does not wait for the Run to finish. The result reaches the master only as a shadow that a human accepts in Releases → Shadows. Use get_run later to report its state.',
    params: [
      {
        name: 'planPath',
        type: 'string',
        required: false,
        description:
          'Path of the plan file to execute, relative to the plans root. Omit to execute the plan attached to the current thread. Not together with `prompt`.',
      },
      { name: 'prompt', type: 'string', required: false, description: 'Free-form instruction to execute instead of a plan. Not together with `planPath`.' },
      { name: 'projectId', type: 'string', required: false, description: 'Project the prompt is addressed to. Only with `prompt`; defaults to the current project.' },
      { name: 'agent', type: 'string', required: false, description: 'Name of the agent definition the Run executes.' },
      {
        name: 'host',
        type: 'string',
        required: false,
        description:
          'Local id of the runner host. Omit when exactly one connected host offers Runs; with several, the call is refused with the list of hosts to choose from.',
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
      'Reports the state of a Run ordered earlier with run_remote: state, outcome, reason and the handoff when there is one — never logs. When the Run left a result, tells in which projects its shadow can be reviewed in Releases → Shadows, or that the shadow is already accepted. Use it when the user asks how a Run is doing.',
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

  it('[entity:run-tools-run-remote] lists run_remote with the record\'s name, description, parameters (all optional, `agent` defaulting to "shadow") and openWorldHint alone; master-computed fields are not parameters', async () => {
    const { client, server } = await connectTo(fx.deps(), fx.readDeps())();
    expect(server.tools.map((t) => t.name)).toEqual(['run_remote', 'get_run', 'cancel_run']);
    expectToolMatchesToolRecord(server.tools[0], RUN_TOOL_RECORDS['run-tools-run-remote']!);
    const listed = (await client.listTools()).tools;
    expect(listed.map((t) => t.name)).toEqual(['run_remote', 'get_run', 'cancel_run']);
    expect(listed[0]!.annotations).toEqual({ openWorldHint: true });
    const props = listed[0]!.inputSchema.properties as Record<string, { default?: unknown }>;
    expect(props.agent?.default).toBe('shadow');
    for (const computed of ['repo', 'home', 'baseSha']) expect(props).not.toHaveProperty(computed);
    expect(listed[0]!.inputSchema.required ?? []).toEqual([]);
  });

  it('[entity:run-tools-run-remote] returns { runId, host } once the host accepts, executing the plan attached to the thread', async () => {
    const { client } = await connectTo(fx.deps(), fx.readDeps())();
    const { isError, body } = await call(client, {});
    expect(isError).toBe(false);
    expect(body.runId).toMatch(RUN_ID_PATTERN);
    expect(body.host).toEqual({ id: 'a', name: 'name-a' });
    expect(stub.requests[0]!.body.input).toEqual({ kind: 'plan', path: 'app/plans/p1.md' });
    expect(stub.requests[0]!.body.agent).toMatchObject({ name: 'shadow' });
  });

  it('[entity:run-tools-run-remote] planPath with prompt, and projectId without prompt, are refused with INVALID_ARGS', async () => {
    const { client } = await connectTo(fx.deps(), fx.readDeps())();
    const both = await call(client, { planPath: 'p1.md', prompt: 'x' });
    expect(both.isError).toBe(true);
    expect(both.body.code).toBe('INVALID_ARGS');
    const orphan = await call(client, { projectId: 'app' });
    expect(orphan.isError).toBe(true);
    expect(orphan.body.code).toBe('INVALID_ARGS');
    expect(stub.requests).toHaveLength(0);
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
    fx.registry.insert(RUN, 'h_a');
    stub.reply = () => ({ status: 200, body: { runId: RUN, hostId: 'h_a', state: 'queued', resultRef: `refs/runs/${RUN}/work`, logs: ['x'] } });
    const { client } = await connectTo(fx.deps(), fx.readDeps())();
    const ok = await call(client, { runId: RUN }, 'get_run');
    expect(ok.isError).toBe(false);
    expect(ok.body).toEqual({ runId: RUN, source: 'host', state: 'queued', resultRef: `refs/runs/${RUN}/work`, shadow: null, hint: null });
    const unknown = await call(client, { runId: '01jb3k9x7q2m4n5p6r8s0t1v2x' }, 'get_run');
    expect(unknown.isError).toBe(true);
    expect(unknown.body.code).toBe('RUN_UNKNOWN');
  });

  it('[entity:run-tools-cancel-run] lists cancel_run with the record\'s name, description, one required string `runId` and the hints destructiveHint, idempotentHint and openWorldHint true', async () => {
    const { client, server } = await connectTo(fx.deps(), fx.readDeps())();
    expectToolMatchesToolRecord(server.tools.find((t) => t.name === 'cancel_run'), RUN_TOOL_RECORDS['run-tools-cancel-run']!);
    const listed = (await client.listTools()).tools.find((t) => t.name === 'cancel_run')!;
    expect(listed.annotations).toEqual({ destructiveHint: true, idempotentHint: true, openWorldHint: true });
    expect(listed.inputSchema.required).toEqual(['runId']);
  });

  it('[entity:run-tools-cancel-run] cancel_run posts the cancel and returns the Run with its source; a finished Run comes back unchanged', async () => {
    fx.registry.insert(RUN, 'h_a');
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
  it('[entity:run-remote] run_remote: workspace, agent-mediated, internal direct rendered by run-tools.run_remote, cli/mcp/rest n/a with the record\'s reasons, effect db, not idempotent, the record\'s 21 codes, rules error-code-once/echo-free/explicit-addressing', () => {
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
          'RUN_NO_HOST',
          'RUN_HOST_REQUIRED',
          'RUN_HOST_NOT_FOUND',
          'RUN_HOST_NOT_CONNECTED',
          'RUN_HOST_WITHOUT_RUNS',
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
