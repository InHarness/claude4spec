import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 0.2.8 (A19): this service is the SECOND `adapter.execute` call site in the server, and it
 * used to run with no filesystem scope at all — which under the agent-adapters contract also
 * means `permissionMode: 'bypassPermissions'` and a full mutating built-in toolset. It is
 * reachable as the MCP tool `analyze_ac_against_entities` from ANY turn, including a
 * read-only `ask` turn, so an unscoped turn here was a write path into the C4S artifact dirs.
 *
 * These tests pin the scope down and, crucially, pin its PARITY with the chat turn: the
 * deny-set must come from the same builder, not from a second implementation that can drift.
 */
const executeMock = vi.hoisted(() => vi.fn(() => (async function* () {})()));
vi.mock('@inharness-ai/agent-adapters', () => ({
  createAdapter: () => ({ execute: executeMock }),
  extractText: async () => '{"issues":[]}',
}));

const { AcAnalysisService } = await import('./ac-analysis.service.js');
const { resolveAgentExecutionScope } = await import('../../services/agent-execution-scope.js');

describe('AcAnalysisService — adapter execution scope (A19)', () => {
  let cwd: string;

  const deps = () =>
    ({
      cwd,
      roots: [],
      host: { getEntity: () => ({}) },
      db: {},
      acService: {
        listRaw: () => [
          { slug: 'ac-1', text: 'the thing works', kind: 'behavior', tags: [], verifies: [] },
        ],
      },
    }) as never;

  beforeEach(() => {
    cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-ac-analysis-')));
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.claude4spec', 'config.json'),
      JSON.stringify({ agent: { allowedPaths: ['src'], disallowedPaths: ['secrets'] } }),
    );
    executeMock.mockClear();
  });
  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  /** An AC with no `verifies` is skipped before the adapter runs — give it one that resolves. */
  const depsWithResolvableAc = () => {
    const d = deps() as unknown as Record<string, unknown>;
    (d.acService as { listRaw: () => unknown[] }).listRaw = () => [
      {
        slug: 'ac-1',
        text: 'the thing works',
        kind: 'behavior',
        tags: [],
        verifies: [{ type: 'endpoint', slug: 'e-1' }],
      },
    ];
    // RawEntityReader reads through the `db` handle; stub the one query it makes.
    d.db = {
      prepare: () => ({
        get: () => ({ slug: 'e-1', type: 'endpoint', data_json: '{}', status: 'active' }),
        all: () => [],
      }),
    };
    return d as never;
  };

  it('passes the resolved path scope, the sandbox and planMode to adapter.execute', async () => {
    await new AcAnalysisService(depsWithResolvableAc()).analyze();

    expect(executeMock).toHaveBeenCalledTimes(1);
    const args = executeMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    // Without these two the library's scope gate never engages ⇒ bypassPermissions.
    expect(args.allowedPaths).toBeDefined();
    expect(args.disallowedPaths).toBeDefined();
    expect((args.disallowedPaths as string[]).length).toBeGreaterThan(0);
    // The audit only reads — read-only built-in toolset.
    expect(args.planMode).toBe(true);
    // The hard layer.
    expect((args.architectureConfig as Record<string, unknown>).claude_sandbox).toBeDefined();
  });

  it('denies the C4S artifact dirs', async () => {
    await new AcAnalysisService(depsWithResolvableAc()).analyze();
    const args = executeMock.mock.calls[0][0] as unknown as { disallowedPaths: string[] };
    for (const dir of ['plans', 'briefs', 'patches', 'entities', 'releases']) {
      expect(args.disallowedPaths).toContain(path.join(cwd, '.claude4spec', dir));
    }
  });

  it('uses the SAME deny-set the chat turn builds for the same project config (parity)', async () => {
    await new AcAnalysisService(depsWithResolvableAc()).analyze();
    const args = executeMock.mock.calls[0][0] as unknown as {
      allowedPaths: string[];
      disallowedPaths: string[];
      architectureConfig: { claude_sandbox: unknown };
    };
    // The reference: exactly what `runAgentTurn` feeds `adapter.execute`, from the one
    // shared builder. Equality here is the point — a second implementation would drift.
    const reference = resolveAgentExecutionScope({ cwd, roots: [] });
    expect(args.disallowedPaths).toEqual(reference.disallowedPaths);
    expect(args.allowedPaths).toEqual(reference.allowedPaths);
    expect(args.architectureConfig.claude_sandbox).toEqual(reference.claudeSandbox);
  });

  it('picks up a config edit without a restart (scope resolved per call, not per mount)', async () => {
    const service = new AcAnalysisService(depsWithResolvableAc());
    await service.analyze();
    const first = executeMock.mock.calls[0][0] as unknown as { disallowedPaths: string[] };
    expect(first.disallowedPaths).not.toContain(path.join(cwd, 'later'));

    fs.writeFileSync(
      path.join(cwd, '.claude4spec', 'config.json'),
      JSON.stringify({ agent: { disallowedPaths: ['later'] } }),
    );
    await service.analyze();
    const second = executeMock.mock.calls[1][0] as unknown as { disallowedPaths: string[] };
    expect(second.disallowedPaths).toContain(path.join(cwd, 'later'));
  });
});
