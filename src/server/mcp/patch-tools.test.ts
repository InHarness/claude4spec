import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { buildPatchToolsServer, PATCH_THREAD_TOOL_NAMES } from './patch-tools.js';
import { PatchService } from '../services/patch.js';
import { ChatService } from '../services/chat.js';
import { MarkdownFileStore } from '../services/pages.js';
import { FileSerializer } from '../services/file-serializer.js';
import { FileVersionService } from '../services/file-version.js';
import { PagesFrontmatterIndexer } from '../services/pages-frontmatter-indexer.js';
import { FileWatchRuntime } from '../fs/watcher.js';
import { artifactSource, boundWriter } from '../fs/sources.js';
import { systemRootId } from '../../shared/root-kinds.js';
import { CATALOG } from '../operations/catalog.js';
import { registerCoreOperations } from '../operations/core-operations.js';
import { CONTEXT_TYPE_REGISTRY } from '../services/chat-context.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import { createPatch } from '../services/patch-write.js';
import { expectPatchOperationRecord } from '../../../tests/helpers/patch-tool-records.js';

/**
 * 2.1.4 (M23) — `patch-tools`, the patch thread's own server: `get_patch` and
 * `mark_patch_applied`, addressed by the thread's `patch_path` when `path` is
 * omitted. Real PatchService over a temp dir, so the no-op assertion is about
 * the file, the version row and the broadcast — not about a mock.
 */

const patchFile = (applied: boolean, body: string) =>
  ['---', 'type: patch', 'brief: b.md', 'patch_kind: drift', `applied: ${applied}`, '---', '', body, ''].join('\n');

describe('patch-tools (thread-bound)', () => {
  let cwd: string;
  let db: Database.Database;
  let client: Client;
  let service: PatchService;
  let broadcast: ReturnType<typeof vi.fn>;

  async function connect(patchPath = 'p.md') {
    const { server } = buildPatchToolsServer({ threadId: 't-1', patchPath, patchService: service });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-patch-tools-'));
    db = createTestDb();
    const patchesPages = new MarkdownFileStore({ cwd, dir: 'patches', rootId: systemRootId('patches'), kind: 'patches' });
    await patchesPages.ensureRoot();
    const runtime = new FileWatchRuntime({ fsEvents: false });
    runtime.mountSource({ source: artifactSource('patch'), dir: patchesPages.root, scope: 'context:test' });
    const watch = runtime.scoped('context:test');
    const patchesSerializer = new FileSerializer(patchesPages);
    broadcast = vi.fn();
    const ws: WsEmitter = { broadcast };
    service = new PatchService({
      patchesPages,
      patchesWatcher: boundWriter(watch, artifactSource('patch')),
      patchesSerializer,
      pageVersions: new FileVersionService(db, patchesSerializer),
      chatService: new ChatService(db),
      frontmatterIndexer: new PagesFrontmatterIndexer(
        new Map([[systemRootId('patches'), patchesPages]]),
        ws,
        new Map([[systemRootId('patches'), 'patches:changed']]),
      ),
    } as ConstructorParameters<typeof PatchService>[0]);
    await fs.writeFile(path.join(patchesPages.root, 'p.md'), patchFile(false, '# Patch\n\nline A\nline B'), 'utf-8');
    await fs.writeFile(path.join(patchesPages.root, 'done.md'), patchFile(true, '# Done'), 'utf-8');
    await connect();
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  async function call(name: string, args: Record<string, unknown>) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    const parsed = JSON.parse(text) as Record<string, any>;
    return { isError: res.isError === true, body: (parsed.data ?? parsed) as Record<string, any>, raw: parsed };
  }

  const versionCount = (p: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM file_version WHERE path = ?`).get(p) as { n: number }).n;

  it('mounts exactly get_patch and mark_patch_applied; get_patch is readOnly', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...PATCH_THREAD_TOOL_NAMES]);
    expect(tools.find((t) => t.name === 'get_patch')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'mark_patch_applied')?.annotations?.readOnlyHint).toBeUndefined();
  });

  it('[section:bpejzx03] internal rendering: no isolation declared for patches, so `path` is in the schema and optional on both tools', async () => {
    const { tools } = await client.listTools();
    for (const name of PATCH_THREAD_TOOL_NAMES) {
      const schema = tools.find((t) => t.name === name)?.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      expect(schema.properties, name).toHaveProperty('path');
      expect(schema.required ?? [], name).not.toContain('path');
    }
    // Omitting it addresses the thread's own patch (the binding matrix supplies it).
    expect((await call('get_patch', {})).body.path).toBe('p.md');
  });

  it('every patch operation with internal = direct has a tool here, and the counts match', () => {
    registerCoreOperations();
    const internalDirect = CATALOG.list()
      .filter((op) => op.name.endsWith('_patch') || op.name.includes('_patch_'))
      .filter((op) => op.channels.internal.kind === 'direct')
      .map((op) => op.name)
      .sort();
    expect(internalDirect).toEqual([...PATCH_THREAD_TOOL_NAMES].sort());
  });

  /**
   * 2.1.18 (M23 `jbcb06l2`, M44 `3f5ej79s`) — the criterion counts the patch
   * operations RENDERED in a `patch` thread: `internal: direct` rows whose
   * rendering is this server. A patch thread mounts patch-tools and no other
   * patch-operation surface (2.1.18 took `transagent-tools` off it), so the two
   * `mcp-tool` entities with `server: patch-tools` are the whole set.
   */
  it('[ac:ac-kazda-operacja-patcha-z-wartoscia-dir] every patch operation with internal = direct rendered in a patch thread has an mcp-tool entity on patch-tools, and their count equals the tools mounted on a patch thread', async () => {
    registerCoreOperations();
    const PATCH_TOOL_ENTITIES = ['patch-tools-get-patch', 'patch-tools-mark-patch-applied'];
    const internalDirect = CATALOG.list()
      .filter((op) => op.name.endsWith('_patch') || op.name.includes('_patch_'))
      .filter((op) => op.channels.internal.kind === 'direct')
      .map((op) => op.name)
      .sort();

    // What the patch thread actually mounts on its patch-tools server.
    const mounted = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(mounted).toEqual(internalDirect);
    // One entity per mounted tool — slug `patch-tools-<tool name>`.
    expect(PATCH_TOOL_ENTITIES.length).toBe(mounted.length);
    expect(PATCH_TOOL_ENTITIES.map((slug) => slug.replace(/^patch-tools-/, '').replace(/-/g, '_')).sort()).toEqual(mounted);

    // The patch thread has no second surface rendering patch operations: no transagent-tools.
    expect(CONTEXT_TYPE_REGISTRY.patch.mcp.transagentTools).toBe(false);
  });

  it('get_patch without path returns the thread\'s patch: path, frontmatter, content, hash', async () => {
    const res = await call('get_patch', {});
    expect(res.isError).toBe(false);
    expect(res.body.path).toBe('p.md');
    expect(res.body.frontmatter).toEqual({ patch_kind: 'drift', applied: false, brief: 'b.md' });
    expect(res.body.content).toContain('line B');
    expect(res.body.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('get_patch with range returns the line window, no sectionIndexed gate', async () => {
    const all = (await call('get_patch', {})).body.content.split('\n');
    const lineB = all.indexOf('line B') + 1;
    const res = await call('get_patch', { range: { start: lineB, end: lineB } });
    expect(res.isError).toBe(false);
    expect(res.body.content.trim()).toBe('line B');
  });

  it('get_patch with range past the end is INVALID_ARGUMENT stating the file size', async () => {
    const res = await call('get_patch', { range: { start: 999, end: 1000 } });
    expect(res.isError).toBe(true);
    expect(res.raw.error?.code ?? res.raw.code).toBe('INVALID_ARGUMENT');
    expect(JSON.stringify(res.raw)).toMatch(/\d+ lines?/);
  });

  it('get_patch over the budget without range comes back truncated with a range hint', async () => {
    const big = Array.from({ length: 20000 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n');
    await fs.writeFile(path.join(cwd, 'patches', 'big.md'), patchFile(false, big), 'utf-8');
    const res = await call('get_patch', { path: 'big.md' });
    expect(res.isError).toBe(false);
    expect(res.body.truncated).toBe(true);
    expect(res.body.truncationHint).toMatch(/range/);
  });

  it('an unknown path is PATCH_NOT_FOUND', async () => {
    for (const tool of ['get_patch', 'mark_patch_applied']) {
      const res = await call(tool, { path: 'nope.md', applied: true });
      expect(res.isError, tool).toBe(true);
      expect(res.raw.error?.code ?? res.raw.code, tool).toBe('PATCH_NOT_FOUND');
    }
  });

  it('mark_patch_applied sets applied: true on the thread\'s patch, records a version and notifies', async () => {
    const res = await call('mark_patch_applied', { applied: true });
    expect(res.isError).toBe(false);
    expect(res.body).toEqual({ path: 'p.md', applied: true });
    const onDisk = await fs.readFile(path.join(cwd, 'patches', 'p.md'), 'utf-8');
    expect(onDisk).toMatch(/applied: true/);
    expect(onDisk).toContain('line B');
    expect(versionCount('p.md')).toBe(1);
    expect(broadcast).toHaveBeenCalledWith({ kind: 'patches:changed', path: 'p.md' });
  });

  /**
   * 2.1.18 (M23 `m23pctx1`, `m23edg01`) — a patch thread that finds its patch
   * already folded in says so and FLAGS it. The behaviour has two halves the
   * app owns: the rules served to every `patch` thread order the flag on that
   * outcome, and the thread's own `mark_patch_applied` call (no `path` — the
   * thread's patch) leaves the patch at `applied: true`.
   */
  it('[ac:ac-watek-patch-ktory-stwierdza-ze-patch] after a patch-thread turn that finds the patch already applied, the patch has applied: true', async () => {
    const rules = CONTEXT_TYPE_REGISTRY.patch.interactionRules ?? '';
    expect(rules).toMatch(/already folded into the specification[^\n]*do NOT force a write/);
    expect(rules).toMatch(/ALREADY folded in, you also mark: call mark_patch_applied with applied: true/);

    expect((await service.getPatch('p.md')).frontmatter.applied).toBe(false);
    // The turn's closing call, as the rules direct it: the thread's own patch.
    const res = await call('mark_patch_applied', { applied: true });
    expect(res.isError).toBe(false);
    expect((await service.getPatch('p.md')).frontmatter.applied).toBe(true);
    expect((await call('get_patch', {})).body.frontmatter.applied).toBe(true);
  });

  it('mark_patch_applied with applied: false is refused, pointing at the UI', async () => {
    const res = await call('mark_patch_applied', { applied: false });
    expect(res.isError).toBe(true);
    expect(res.raw.error?.code ?? res.raw.code).toBe('INVALID_ARGUMENT');
    expect(JSON.stringify(res.raw)).toMatch(/UI/);
  });

  it('marking an already-applied patch is a no-op: no write, no version, no notification', async () => {
    const before = await fs.readFile(path.join(cwd, 'patches', 'done.md'), 'utf-8');
    const res = await call('mark_patch_applied', { applied: true, path: 'done.md' });
    expect(res.isError).toBe(false);
    expect(res.body).toEqual({ path: 'done.md', applied: true });
    expect(await fs.readFile(path.join(cwd, 'patches', 'done.md'), 'utf-8')).toBe(before);
    expect(versionCount('done.md')).toBe(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('a patch past the response budget keeps its whole body when marked applied', async () => {
    const big = Array.from({ length: 20000 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n');
    await fs.writeFile(path.join(cwd, 'patches', 'big.md'), patchFile(false, big), 'utf-8');
    await call('mark_patch_applied', { applied: true, path: 'big.md' });
    const onDisk = await fs.readFile(path.join(cwd, 'patches', 'big.md'), 'utf-8');
    expect(onDisk).toContain('line 19999 ');
  });

  // ── spec-operation records (2.1.26) ──────────────────────────────────────
  //
  // The M23 operations as their `spec-operation` records declare them at 2.1.26:
  // name, scope, mediation, the four channel cells (an `n/a` / `via` carrying the
  // record's `powody` verbatim), effects, idempotence, content input, exactly the
  // record's `kodyBledow`, and `renderings` exactly its `narzedzia`. `list-patches`
  // is asserted beside its REST rendering (routes/artifacts.test.ts).

  const notAPatch = async (rel: string) =>
    fs.writeFile(path.join(cwd, 'patches', rel), ['---', 'type: plan', 'title: Not a patch', '---', '', '# Plan', ''].join('\n'), 'utf-8');

  it('[entity:create-patch] create_patch as its record declares it: project, direct, internal/mcp n/a with the record\'s reasons, cli/rest direct, file+db+ui-notify, not idempotent, literal content, codes BRIEF_NOT_FOUND, VALIDATION, PATCH_WRITE_FAILED, no renderings — the slug `{brief-slug}-{slugify(desc)}.md` from the server, two filings of one drift two files, an unknown brief BRIEF_NOT_FOUND, a missing brief / empty desc / no body / unknown kind VALIDATION', async () => {
    const op = expectPatchOperationRecord({
      nazwa: 'create_patch',
      channels: {
        internal: { kind: 'na', reason: 'producentem patcha jest terminalowy agent-implementer, a wątek `patch` patch **stosuje**, zamiast go zgłaszać' },
        cli: { kind: 'direct' },
        mcp: { kind: 'na', reason: 'zgłoszenie driftu ma jednego producenta, implementera pracującego kanałem `cli`' },
        rest: { kind: 'direct' },
      },
      efekty: ['file', 'db', 'ui-notify'],
      idempotencja: false,
      opisTresci: 'literal',
      kodyBledow: ['BRIEF_NOT_FOUND', 'VALIDATION', 'PATCH_WRITE_FAILED'],
      narzedzia: {},
    });
    // The intent, not a finished file: brief, desc, kind, body (+ reporter).
    expect(Object.keys(op.inputSchema).sort()).toEqual(['body', 'brief', 'createdBy', 'desc', 'patchKind']);
    // No patch-thread tool files a patch.
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain('create_patch');

    const briefsDirAbs = path.join(cwd, 'briefs');
    const patchesDirAbs = path.join(cwd, 'patches');
    await fs.mkdir(briefsDirAbs, { recursive: true });
    await fs.writeFile(path.join(briefsDirAbs, 'v1-to-v2.md'), '---\ntype: brief\n---\n\n# Brief\n', 'utf-8');
    const deps = { briefsDirAbs, patchesDirAbs };
    const input = { brief: 'v1-to-v2.md', desc: 'Missing path', body: 'what drifted' };

    const first = await createPatch(deps, input, 'rest');
    expect(first).toEqual({ path: 'v1-to-v2-missing-path.md' });
    const second = await createPatch(deps, input, 'rest');
    expect(second.path).not.toBe(first.path);
    expect((await fs.readdir(patchesDirAbs)).filter((f) => f.startsWith('v1-to-v2-missing-path'))).toHaveLength(2);
    const written = await fs.readFile(path.join(patchesDirAbs, first.path), 'utf-8');
    expect(written).toMatch(/type: patch/);
    expect(written).toMatch(/brief: v1-to-v2\.md/);
    expect(written).toMatch(/applied: false/);

    await expect(createPatch(deps, { ...input, brief: 'no-such-brief.md' }, 'rest')).rejects.toMatchObject({ code: 'BRIEF_NOT_FOUND' });
    await expect(createPatch(deps, { ...input, brief: undefined }, 'rest')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(createPatch(deps, { ...input, desc: '  ' }, 'rest')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(createPatch(deps, { ...input, body: undefined }, 'rest')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(createPatch(deps, { ...input, patchKind: 'typo' }, 'rest')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('[entity:get-patch] get_patch as its record declares it: project, direct, internal direct, cli/mcp n/a and rest direct with the record\'s reasons, no effects, idempotent, `path` + window `range`, codes PATCH_NOT_FOUND, INVALID_ARGUMENT, PATCH_INVALID_FRONTMATTER, rendered by patch-tools · get_patch (internal) — content, frontmatter and hash; an unknown path PATCH_NOT_FOUND, a window past the end INVALID_ARGUMENT, a non-patch file PATCH_INVALID_FRONTMATTER, content over the response budget truncated: true with a truncationHint pointing at the line window', async () => {
    const op = expectPatchOperationRecord({
      nazwa: 'get_patch',
      channels: {
        internal: { kind: 'direct' },
        cli: { kind: 'na', reason: 'żadna komenda `c4s` nie renderuje jeszcze odczytu patcha' },
        mcp: { kind: 'na', reason: 'odczyt patcha istnieje dla wątku, który ten patch stosuje; kanał `mcp` nie ma wątku zakotwiczonego w patchu' },
        rest: { kind: 'direct' },
      },
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: ['PATCH_NOT_FOUND', 'INVALID_ARGUMENT', 'PATCH_INVALID_FRONTMATTER'],
      narzedzia: { internal: ['patch-tools-get-patch'] },
    });
    expect(Object.keys(op.inputSchema).sort()).toEqual(['path', 'range']);

    const read = await call('get_patch', { path: 'p.md' });
    expect(read.isError).toBe(false);
    expect(read.body.content).toContain('line B');
    expect(read.body.path).toBe('p.md');
    expect(read.body.frontmatter).toMatchObject({ patch_kind: 'drift', brief: 'b.md' });
    expect(read.body.hash).toMatch(/^[0-9a-f]{64}$/);
    // Idempotent: a second read answers the same.
    expect((await call('get_patch', { path: 'p.md' })).body).toEqual(read.body);

    const unknown = await call('get_patch', { path: 'nope.md' });
    expect(unknown.isError).toBe(true);
    expect(unknown.raw.error?.code ?? unknown.raw.code).toBe('PATCH_NOT_FOUND');
    const past = await call('get_patch', { path: 'p.md', range: { start: 999, end: 1000 } });
    expect(past.isError).toBe(true);
    expect(past.raw.error?.code ?? past.raw.code).toBe('INVALID_ARGUMENT');
    await notAPatch('plan-like.md');
    const invalid = await call('get_patch', { path: 'plan-like.md' });
    expect(invalid.isError).toBe(true);
    expect(invalid.raw.error?.code ?? invalid.raw.code).toBe('PATCH_INVALID_FRONTMATTER');

    // 2.1.48 — content over the response budget comes back cut, flagged
    // `truncated: true`, with a `truncationHint` pointing at the line window.
    const big = Array.from({ length: 20000 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n') + '\nLAST LINE';
    await fs.writeFile(path.join(cwd, 'patches', 'big-record.md'), patchFile(false, big), 'utf-8');
    const cut = await call('get_patch', { path: 'big-record.md' });
    expect(cut.isError).toBe(false);
    expect(cut.body.truncated).toBe(true);
    expect(cut.body.truncationHint).toMatch(/range: \{ start: \d+, end: \d+ \}/);
    expect(cut.body.content).not.toContain('LAST LINE');
  });

  it('[entity:mark-patch-applied] mark_patch_applied as its record declares it: project, direct, internal direct, cli/mcp n/a and rest direct with the record\'s reasons, file+db+ui-notify, idempotent, no content, addressed by `path`, codes PATCH_NOT_FOUND, INVALID_ARGUMENT, PATCH_INVALID_FRONTMATTER, rendered by patch-tools · mark_patch_applied (internal) — frontmatter only, through version capture, a repeat a no-op, an unknown path PATCH_NOT_FOUND, `false` INVALID_ARGUMENT, a non-patch file PATCH_INVALID_FRONTMATTER', async () => {
    const op = expectPatchOperationRecord({
      nazwa: 'mark_patch_applied',
      channels: {
        internal: { kind: 'direct' },
        cli: { kind: 'na', reason: 'jedyny realny wołający kończy wdrożenie patcha w wątku, nie w terminalu' },
        mcp: { kind: 'na', reason: 'deklarację wdrożenia składa wątek, który patch stosuje; kanał `mcp` nie ma wątku zakotwiczonego w patchu' },
        rest: { kind: 'direct' },
      },
      efekty: ['file', 'db', 'ui-notify'],
      idempotencja: true,
      opisTresci: 'n/a',
      kodyBledow: ['PATCH_NOT_FOUND', 'INVALID_ARGUMENT', 'PATCH_INVALID_FRONTMATTER'],
      narzedzia: { internal: ['patch-tools-mark-patch-applied'] },
    });
    expect(Object.keys(op.inputSchema).sort()).toEqual(['applied', 'path']);

    // Frontmatter only, through version capture (file + db + ui-notify).
    const bodyBefore = (await service.getPatch('p.md', { full: true })).body;
    expect((await call('mark_patch_applied', { applied: true, path: 'p.md' })).isError).toBe(false);
    const after = await service.getPatch('p.md', { full: true });
    expect(after.frontmatter.applied).toBe(true);
    expect(after.body).toBe(bodyBefore);
    expect(versionCount('p.md')).toBe(1);
    expect(broadcast).toHaveBeenCalledWith({ kind: 'patches:changed', path: 'p.md' });
    const events = broadcast.mock.calls.length;
    // A repeat on the same value: no write, no version, no event.
    const settled = await fs.readFile(path.join(cwd, 'patches', 'p.md'), 'utf-8');
    expect((await call('mark_patch_applied', { applied: true, path: 'p.md' })).isError).toBe(false);
    expect(await fs.readFile(path.join(cwd, 'patches', 'p.md'), 'utf-8')).toBe(settled);
    expect(versionCount('p.md')).toBe(1);
    expect(broadcast.mock.calls.length).toBe(events);

    const unknown = await call('mark_patch_applied', { applied: true, path: 'nope.md' });
    expect(unknown.isError).toBe(true);
    expect(unknown.raw.error?.code ?? unknown.raw.code).toBe('PATCH_NOT_FOUND');
    const unmark = await call('mark_patch_applied', { applied: false, path: 'p.md' });
    expect(unmark.isError).toBe(true);
    expect(unmark.raw.error?.code ?? unmark.raw.code).toBe('INVALID_ARGUMENT');
    await notAPatch('plan-like.md');
    const invalid = await call('mark_patch_applied', { applied: true, path: 'plan-like.md' });
    expect(invalid.isError).toBe(true);
    expect(invalid.raw.error?.code ?? invalid.raw.code).toBe('PATCH_INVALID_FRONTMATTER');
  });
});
