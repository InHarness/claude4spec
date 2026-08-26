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
vi.mock('@inharness-ai/agent-adapters', async (importOriginal) => ({
  // 0.2.53: partial mock. `resolveAgentToolGroups` (reached through the service)
  // reads the real `PLAN_MODE_DENY_GROUPS`, and a hand-written stub of a
  // library constant is exactly the drift this suite exists to catch.
  ...(await importOriginal<typeof import('@inharness-ai/agent-adapters')>()),
  createAdapter: () => ({ execute: executeMock }),
  extractText: async () => '{"issues":[]}',
}));

const { AcAnalysisService } = await import('./ac-analysis.service.js');
const { resolveAgentExecutionScope } = await import('../../services/agent-execution-scope.js');

describe('AcAnalysisService — adapter execution scope (A19)', () => {
  let cwd: string;

  /**
   * 2.0.0 tier K — the fixture is a READER, not an `AcService` plus a raw `db`
   * handle. `readActiveAcs` asks it three questions (which slugs match the
   * declared `status` default, the row, the `verifies` collection) and the
   * dossier builder asks it for each verified entity; this stub answers exactly
   * those and nothing else.
   */
  const reader = (verifies: Array<{ type: string; slug: string }>) => ({
    slugsMatching: () => new Set(['ac-1']),
    listSlugs: () => ['ac-1'],
    /**
     * 0.2.11: "is this verify's type real?" is asked of the registry rather than
     * a seven-literal predicate, so the reader stub has to carry a host. This
     * one recognises every type — the suite's cases are about analysis, not
     * about unknown-type classification.
     */
    host: { getEntity: () => ({}) },
    /**
     * `verifies` goes in `data`, where the real reader puts it.
     *
     * This stub used to answer `readCollection: () => verifies`, which is how
     * the embedded-vs-projected mix-up in `read-acs.ts` survived: the fake
     * confirmed the caller's own belief about the storage layout instead of
     * contradicting it. `read-acs.test.ts` now covers the layout against a real
     * projection; this file only needs the ANALYSIS behaviour, so the stub still
     * earns its place — it just has to be wrong in no interesting way.
     */
    getEntity: (type: string, slug: string) =>
      type === 'ac'
        ? { type, slug, tags: [], data: { text: 'the thing works', kind: 'behavior', verifies } }
        : { type, slug, tags: [], data: {} },
  });

  const host = () => ({ getEntity: () => ({}) });

  /**
   * 0.2.24 — the audit reads each verified entity through the M39 core, so the
   * stub answers as the core does: `results[].entity`, the record rather than
   * the row. These cases are about the adapter turn, so one non-null record is
   * all they need to get past the all-verifies-broken skip.
   */
  const discovery = () => () =>
    ({
      getEntities: () => ({ results: [{ slug: 'e-1', entity: { slug: 'e-1' } }] }),
      // No content-bearing field ⇒ nothing to inline; the cases below are about
      // the adapter turn, not about the record's shape.
      describeTypes: () => ({ types: [{ contentFields: [] }] }),
      getFieldContent: () => ({ content: '' }),
    }) as never;

  const deps = () =>
    ({ cwd, roots: [], host: host(), discovery: discovery(), reader: reader([]) }) as never;

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
  const depsWithResolvableAc = () =>
    ({
      cwd,
      roots: [],
      host: host(),
      discovery: discovery(),
      reader: reader([{ type: 'endpoint', slug: 'e-1' }]),
    }) as never;

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

  /**
   * 0.2.24 — the record answers a content-bearing field with a DESCRIPTOR, never
   * with the value. For a type whose body essentially is that field (a diagram's
   * `source`), an audit shown `{sourceHas: true, sourceBytes: 42}` is being asked
   * to judge text it was not given. The descriptor names the operation that
   * issues the content; the audit follows it.
   */
  it('inlines content-bearing fields the record would only describe', async () => {
    const getFieldContent = vi.fn(() => ({ content: 'flowchart TD; A-->B' }));
    const deps = {
      cwd,
      roots: [],
      host: host(),
      reader: reader([{ type: 'diagram', slug: 'e-1' }]),
      discovery: () =>
        ({
          getEntities: () => ({
            results: [{ slug: 'e-1', entity: { slug: 'e-1', sourceHas: true, sourceBytes: 19 } }],
          }),
          describeTypes: () => ({
            types: [{ contentFields: [{ field: 'source', operation: 'get_field_content' }] }],
          }),
          getFieldContent,
        }) as never,
    } as never;

    await new AcAnalysisService(deps).analyze();

    expect(getFieldContent).toHaveBeenCalledWith({
      type: 'diagram',
      slug: 'e-1',
      field: 'source',
    });
    const [[args]] = executeMock.mock.calls as unknown as [[{ prompt: string }]];
    expect(args.prompt).toContain('flowchart TD; A-->B');
  });

  /** A field the entity does not carry is not fetched — the descriptor said so. */
  it('does not fetch content for a field the record reports as empty', async () => {
    const getFieldContent = vi.fn(() => ({ content: '' }));
    const deps = {
      cwd,
      roots: [],
      host: host(),
      reader: reader([{ type: 'diagram', slug: 'e-1' }]),
      discovery: () =>
        ({
          getEntities: () => ({
            results: [{ slug: 'e-1', entity: { slug: 'e-1', sourceHas: false, sourceBytes: 0 } }],
          }),
          describeTypes: () => ({
            types: [{ contentFields: [{ field: 'source', operation: 'get_field_content' }] }],
          }),
          getFieldContent,
        }) as never,
    } as never;

    await new AcAnalysisService(deps).analyze();

    expect(getFieldContent).not.toHaveBeenCalled();
  });
});
