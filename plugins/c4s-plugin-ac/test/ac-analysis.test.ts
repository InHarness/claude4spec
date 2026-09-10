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

const { AcAnalysisService } = await import('../src/entity/ac/backend/analysis.service.js');
const { resolveAgentExecutionScope, resolveAgentTurnScope } = await import(
  '../../../src/server/services/agent-execution-scope.js'
);

describe('AcAnalysisService — adapter execution scope (A19)', () => {
  let cwd: string;

  /**
   * 0.2.80 — the fixture is the READ OPERATIONS, not a `RawEntityReader`.
   *
   * The service no longer has a reader to stub. `readActiveAcs` asks
   * `listEntities` for the active set and `getEntities` for the width; the
   * dossier builder asks `getEntities` again per verified entity, and
   * `describeTypes`/`getFieldContent` for the content it must inline.
   *
   * The old stub answered `readCollection: () => verifies`, which is how the
   * embedded-vs-projected mix-up in the in-core reader survived: the fake
   * confirmed the caller's own belief about the storage layout instead of
   * contradicting it. That layout question now lives where a REAL projection can
   * answer it (`src/server/discovery/ops/ac-rules.test.ts`), and this file only
   * needs the ANALYSIS behaviour — so a stub still earns its place, as long as
   * it is wrong in no interesting way.
   */
  const readOps = (
    verifies: Array<{ type: string; slug: string }>,
    over: Partial<Record<'getEntities' | 'describeTypes' | 'getFieldContent', unknown>> = {},
  ) => ({
    listEntities: () => ({ mode: 'items', type: 'ac', items: [{ slug: 'ac-1', title: 'the thing works' }], total: 1, hasMore: false }),
    /**
     * Two shapes behind one operation, keyed by type — which is what the real
     * core does. `ac` answers the criterion and its `verifies`; anything else
     * answers the record of a verified entity.
     */
    getEntities: over.getEntities ?? (({ type, slugs }: { type: string; slugs: string[] }) =>
      type === 'ac'
        ? {
            type,
            selectedFields: [],
            results: slugs.map((slug) => ({
              slug,
              entity: { slug, title: 'the thing works', kind: 'requirement', tags: [], verifies },
            })),
          }
        : { type, selectedFields: [], results: slugs.map((slug) => ({ slug, entity: { slug } })) }),
    // No content-bearing field ⇒ nothing to inline; most cases below are about
    // the adapter turn, not about the record's shape.
    describeTypes: over.describeTypes ?? (() => ({ types: [{ contentFields: [] }] })),
    getFieldContent: over.getFieldContent ?? (() => ({ content: '' })),
  });

  /**
   * The registry view. `getEntity` is asked two questions: whether `ac` itself
   * is active, and whether each `verifies[].type` is a type at all — 0.2.11
   * moved the second off a seven-literal predicate and onto the registry, which
   * is why the audit needs a host and not just the read core. This one
   * recognises everything: the cases here are about analysis, not about
   * unknown-type classification.
   */
  const host = () => ({
    getEntity: () => ({}),
    getAvailable: () => ({}),
    isActive: () => true,
    entityExists: () => true,
  });

  /**
   * The REAL resolver, bound exactly as `project-context.ts` binds it.
   *
   * That is the point of the parity case below: the envelope must pass the
   * host's scope through untouched, so the fixture hands it the host's own
   * function rather than a stub that could agree with a bug.
   */
  const agentScope = (opts?: { planMode?: boolean }) =>
    resolveAgentTurnScope({ cwd, roots: [], planMode: opts?.planMode });

  const deps = () => ({ cwd, ...readOps([]), host: host(), agentScope }) as never;

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
      ...readOps([{ type: 'endpoint', slug: 'e-1' }]),
      host: host(),
      agentScope,
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
      ...readOps([{ type: 'diagram', slug: 'e-1' }], {
        getEntities: ({ type, slugs }: { type: string; slugs: string[] }) =>
          type === 'ac'
            ? {
                type,
                selectedFields: [],
                results: slugs.map((slug) => ({
                  slug,
                  entity: {
                    slug,
                    title: 'the thing works',
                    kind: 'requirement',
                    tags: [],
                    verifies: [{ type: 'diagram', slug: 'e-1' }],
                  },
                })),
              }
            : {
                type,
                selectedFields: [],
                results: [{ slug: 'e-1', entity: { slug: 'e-1', sourceHas: true, sourceBytes: 19 } }],
              },
        describeTypes: () => ({
          types: [{ contentFields: [{ field: 'source', operation: 'get_field_content' }] }],
        }),
        getFieldContent,
      }),
      host: host(),
      agentScope,
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
      ...readOps([{ type: 'diagram', slug: 'e-1' }], {
        getEntities: ({ type, slugs }: { type: string; slugs: string[] }) =>
          type === 'ac'
            ? {
                type,
                selectedFields: [],
                results: slugs.map((slug) => ({
                  slug,
                  entity: {
                    slug,
                    title: 'the thing works',
                    kind: 'requirement',
                    tags: [],
                    verifies: [{ type: 'diagram', slug: 'e-1' }],
                  },
                })),
              }
            : {
                type,
                selectedFields: [],
                results: [{ slug: 'e-1', entity: { slug: 'e-1', sourceHas: false, sourceBytes: 0 } }],
              },
        describeTypes: () => ({
          types: [{ contentFields: [{ field: 'source', operation: 'get_field_content' }] }],
        }),
        getFieldContent,
      }),
      host: host(),
      agentScope,
    } as never;

    await new AcAnalysisService(deps).analyze();

    expect(getFieldContent).not.toHaveBeenCalled();
  });
});
