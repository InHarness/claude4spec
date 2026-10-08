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
import type { WsEmitter } from '../ws/project-emitter.js';

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

  it('every patch operation with internal = direct has a tool here, and the counts match', () => {
    registerCoreOperations();
    const internalDirect = CATALOG.list()
      .filter((op) => op.name.endsWith('_patch') || op.name.includes('_patch_'))
      .filter((op) => op.channels.internal.kind === 'direct')
      .map((op) => op.name)
      .sort();
    expect(internalDirect).toEqual([...PATCH_THREAD_TOOL_NAMES].sort());
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
});
