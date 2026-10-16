import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { FileWatchRuntime } from '../fs/watcher.js';
import { RootRegistry } from '../roots/registry.js';
import { RootSet } from '../discovery/roots.js';
import { SectionsService } from '../services/sections.js';
import type { Root } from '../../shared/types.js';
import { registerCoreReactions } from '../workspace/core-reactions.js';
import { mountRegistryRoots } from '../workspace/root-registry-runtime.js';
import { createPageToolsServer } from './page-tools.js';
import { expectToolMatchesWriteRecord } from '../../../tests/helpers/write-tool-records.js';

/**
 * 2.1.9 — `page-tools` over the roots WITH A FACADE (M02 `o01s9mwl`): the four
 * page write operations address the roots whose kind's `sidebar` is not
 * `hidden`, in every channel; agent discovery addresses the `kind: pages` roots.
 * The rig wires the server exactly as `project-context.ts` does — `resolveRoot`
 * and `rootIds` over the facade runtimes the L13 build hook produced.
 */

registerCoreReactions();

const USER_ROOTS: Root[] = [
  { id: 'pages', name: 'Pages', dir: 'pages', builtin: true },
  { id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false },
];

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const sha = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

async function rig() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-page-tools-facades-'));
  cleanups.push(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const runtime = new FileWatchRuntime({ fsEvents: false });
  cleanups.push(() => runtime.close());
  const db: Database.Database = createTestDb();
  cleanups.push(() => db.close());
  const registry = new RootRegistry(USER_ROOTS);
  const mounted = await mountRegistryRoots({
    cwd,
    registry,
    userRoots: USER_ROOTS,
    w: runtime.scoped('context:page-tools-facades#1'),
  });
  const rootById = new Map(mounted.rootRuntimes.map((rt) => [rt.root.id, rt]));
  const instance = createPageToolsServer({
    sections: new SectionsService(db),
    resolveRoot: (rootId) => {
      const rt = rootById.get(rootId);
      return rt ? { pages: rt.pages, writer: rt.writer, versions: null } : undefined;
    },
    rootIds: () => [...rootById.keys()],
  });
  const { server } = instance;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanups.push(() => client.close());
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
  };
  const abs = (rootId: string, rel: string): string => path.join(cwd, registry.get(rootId)!.dir, rel);
  return { client, call, abs, registry, tools: instance.tools };
}

describe('2.1.9 — page-tools address the roots with a facade (M02 o01s9mwl, gj2vdsjm)', () => {
  it('[entity:page-tools-create-page] create_page on page-tools: the 2.1.26 record\'s description and parameters (rootId + path required, title + content optional), no hints; answers { rootId, path, hash, version, content, anchors[] } with `content` the file AS IT SETTLED (the template when no content was sent); unknown root ROOT_NOT_FOUND with the roots in `hint`, empty path VALIDATION, an existing page PAGE_EXISTS pointing at update_page', async () => {
    const { client, call, abs, tools: declared } = await rig();
    expectToolMatchesWriteRecord(declared.find((t) => t.name === 'create_page'), 'page-tools-create-page');
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'create_page')!;
    expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual(['content', 'path', 'rootId', 'title']);
    expect([...(tool.inputSchema.required ?? [])].sort()).toEqual(['path', 'rootId']);

    const res = await call('create_page', { rootId: 'adr', path: 'guides/auth.md', content: '# Auth\n\n## Login\n' });
    expect(res.isError).toBe(false);
    expect(Object.keys(res.body).sort()).toEqual(['anchors', 'content', 'hash', 'path', 'rootId', 'version']);
    expect(res.body.rootId).toBe('adr');
    expect(res.body.path).toBe('guides/auth.md');
    const onDisk = fs.readFileSync(abs('adr', 'guides/auth.md'), 'utf8');
    // `content` is the settled file, and `hash` is its sha256 — not the bytes that were sent.
    expect(res.body.content).toBe(onDisk);
    expect(res.body.hash).toBe(sha(onDisk));
    expect(Array.isArray(res.body.anchors)).toBe(true);
    // Every anchor the answer lists is a comment in the content it answers.
    for (const anchor of res.body.anchors as string[]) expect(res.body.content).toContain(`<!-- anchor: ${anchor} -->`);
    expect(typeof res.body.version).toBe('number');

    // Omitting `content` writes the default template — a frontmatter block with `title` — and answers it.
    const tpl = await call('create_page', { rootId: 'pages', path: 'empty.md', title: '  Empty  ' });
    expect(tpl.isError).toBe(false);
    const tplOnDisk = fs.readFileSync(abs('pages', 'empty.md'), 'utf8');
    expect(tplOnDisk).toContain('title: Empty');
    expect(tpl.body.content).toBe(tplOnDisk);
    // …and without a title the file name, extension dropped.
    const untitled = await call('create_page', { rootId: 'pages', path: 'nested/m16-onboarding.md' });
    expect(untitled.body.content).toContain('title: m16-onboarding');

    const dup = await call('create_page', { rootId: 'adr', path: 'guides/auth.md', content: 'clobber' });
    expect(dup.isError).toBe(true);
    expect(dup.body.code).toBe('PAGE_EXISTS');
    expect(dup.body.hint).toContain('update_page');
    expect(fs.readFileSync(abs('adr', 'guides/auth.md'), 'utf8')).toBe(onDisk);

    const emptyPath = await call('create_page', { rootId: 'pages', path: '' });
    expect(emptyPath.isError).toBe(true);
    expect(emptyPath.body.code).toBe('VALIDATION');

    const refused = await call('create_page', { rootId: 'briefs', path: 'b.md', content: '# B\n' });
    expect(refused.isError).toBe(true);
    expect(refused.body.code).toBe('ROOT_NOT_FOUND');
    // (2.1.9: `skills`, M52, is a root with a facade too.)
    expect(refused.body.hint).toBe('active roots: [pages, adr, skills]');
    expect(fs.existsSync(abs('briefs', 'b.md'))).toBe(false);
  });

  it('[ac:ac-zadna-operacja-rdzenia-nie-ma-parametru] no page operation — discovery or write — can address a brief, patch, plan or the entity catalog: discovery resolves only `kind: pages` roots, the writes only roots with a facade, and no input carries a directory or a kind', async () => {
    const { client, call, abs, registry } = await rig();
    const forbidden = ['briefs', 'patches', 'plans', 'entities'] as const;
    for (const id of forbidden) expect(registry.get(id)?.kind, id).toBe(id);

    // Write side: the only addressing parameter is `rootId` (+ root-relative paths);
    // `update_sections` addresses by section anchor, which only indexed page roots mint.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['create_page', 'delete_page', 'move_page', 'update_page', 'update_sections']);
    for (const tool of tools) {
      const props = Object.keys(tool.inputSchema.properties ?? {});
      if (tool.name !== 'update_sections') expect(props, tool.name).toContain('rootId');
      for (const p of ['dir', 'kind', 'absolutePath', 'cwd', 'source', 'artifact', 'brief', 'patch', 'plan']) {
        expect(props, tool.name).not.toContain(p);
      }
    }
    // … and every system root id it could be given is refused, with nothing written.
    const seeded = '---\ntype: x\n---\n# Seeded\n';
    for (const id of forbidden) {
      const rel = id === 'entities' ? 'endpoint/e.json' : 'seeded.md';
      fs.mkdirSync(path.dirname(abs(id, rel)), { recursive: true });
      fs.writeFileSync(abs(id, rel), seeded);
      const attempts: Array<[string, Record<string, unknown>]> = [
        ['create_page', { rootId: id, path: 'new.md', content: '# New\n' }],
        ['update_page', { rootId: id, path: rel, body: 'hijack', expectedHash: sha(seeded) }],
        ['delete_page', { rootId: id, path: rel }],
        ['move_page', { rootId: id, from: rel, to: 'moved.md', expectedHash: sha(seeded) }],
      ];
      for (const [tool, args] of attempts) {
        const res = await call(tool, args);
        expect(res.isError, `${tool}@${id}`).toBe(true);
        expect(res.body.code, `${tool}@${id}`).toBe('ROOT_NOT_FOUND');
      }
      expect(fs.readFileSync(abs(id, rel), 'utf8')).toBe(seeded);
      expect(fs.existsSync(abs(id, 'new.md'))).toBe(false);
      expect(fs.existsSync(abs(id, 'moved.md'))).toBe(false);
    }

    // Discovery side: the core's root set is the `kind: pages` roots; a system
    // root id is the same INVALID_ARGUMENT as an unknown one.
    const discoveryRoots = new RootSet(registry.pages().map((r) => USER_ROOTS.find((u) => u.id === r.id)!));
    expect(discoveryRoots.ids()).toEqual(['pages', 'adr']);
    for (const id of forbidden) {
      expect(() => discoveryRoots.require(id, 'list_pages'), id).toThrow(/unknown rootId/);
    }
    expect(discoveryRoots.require('adr', 'list_pages').id).toBe('adr');
  });
});
