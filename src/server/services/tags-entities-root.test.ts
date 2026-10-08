/**
 * 2.1.8 — M29 `m29l10001` / M18 `9pvs31cv` (Project Scoping, L10).
 *
 * The text an entity or tag mutation writes lands in the `entities` ROOT of the
 * project — the system root the registry carries at `.claude4spec/entities` —
 * and `tags.json` is located through that root, never through a config key. A
 * leftover pre-2.1.8 `entitiesDir` in `config.json` moves nothing.
 *
 * The store is built the way `buildProjectContext` builds it: from
 * `new RootRegistry(readConfig(cwd).roots).system('entities').dir`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { configPath, loadOrCreateConfig, readConfig } from '../config.js';
import { RootRegistry } from '../roots/registry.js';
import { EntityStore } from './entity-store.js';
import { TagsService } from './tags.js';
import { ReferencesService } from './references.js';
import { MarkdownFileStore } from './markdown-file-store.js';
import { fileMapEntryOf } from '../../shared/root-kinds.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { SelfWriteSuppressor } from '../fs/sources.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('tags.json lives in the `entities` root of the project', () => {
  it('M29 m29l10001 / M18 9pvs31cv: a tag mutation writes tags.json into the registry `entities` root; a legacy `entitiesDir` key is ignored', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-tags-root-'));
    dirs.push(cwd);
    loadOrCreateConfig(cwd, {});
    // A pre-2.1.8 config still carrying the removed key, pointing elsewhere.
    const raw = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(configPath(cwd), JSON.stringify({ ...raw, entitiesDir: 'ents' }, null, 2));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const registry = new RootRegistry(readConfig(cwd).roots);
    const entitiesRoot = registry.system('entities');
    expect(entitiesRoot.kind).toBe('entities');
    expect(entitiesRoot.dir).toBe('.claude4spec/entities');

    const db = new Database(':memory:');
    runMigrations(db);
    const tags = new TagsService(db);
    const store = new EntityStore(
      cwd,
      entitiesRoot.dir,
      { suppress: () => {} } as unknown as SelfWriteSuppressor,
      { listTags: () => tags.list() } as unknown as RawEntityReader,
      {} as unknown as PluginHost,
    );
    tags.setEntityStore(store);

    tags.create({ name: 'Billing', color: '#123456' });

    const tagsFile = path.join(cwd, '.claude4spec', 'entities', 'tags.json');
    expect(fs.existsSync(tagsFile)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(tagsFile, 'utf8')) as Array<{ slug: string; name: string }>;
    expect(onDisk.map((t) => [t.slug, t.name])).toEqual([['billing', 'Billing']]);
    expect(store.tagsFileExists()).toBe(true);
    // The legacy key's directory is never created nor written.
    expect(fs.existsSync(path.join(cwd, 'ents'))).toBe(false);
    db.close();
  });

  it('M18 91vuvf2u / m18l13rt: a tag slug rename rewrites tags.json and the entity files of the `entities` root, and tags="…" only in markdown of roots whose kind carries `references`', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-tags-rename-'));
    dirs.push(cwd);
    loadOrCreateConfig(cwd, {});
    const cfg = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8')) as { roots: Array<Record<string, unknown>> };
    cfg.roots.push({ id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false });
    fs.writeFileSync(configPath(cwd), JSON.stringify(cfg, null, 2));
    const registry = new RootRegistry(readConfig(cwd).roots);
    const entitiesRoot = registry.system('entities');

    const db = new Database(':memory:');
    runMigrations(db);
    // As the project db handle runs: entity_tag.tag_slug follows the rename by FK cascade.
    db.pragma('foreign_keys = ON');
    const tags = new TagsService(db);
    // Snapshot = the entity's current tag assignments, the part a rename touches.
    const reader = {
      listTags: () => tags.list(),
      getEntity: (_type: string, slug: string) => ({ slug }),
    } as unknown as RawEntityReader;
    const host = {
      snapshot: (type: string, entity: { slug: string }) => ({
        title: entity.slug,
        tags: tags.getEntityTagSlugs(type as never, entity.slug),
      }),
      getEntity: () => undefined,
    } as unknown as PluginHost;
    const store = new EntityStore(cwd, entitiesRoot.dir, { suppress: () => {} } as unknown as SelfWriteSuppressor, reader, host);
    tags.setEntityStore(store);
    tags.create({ name: 'Billing' });
    db.prepare(`INSERT INTO entity_tag (entity_type, entity_slug, tag_slug) VALUES ('endpoint', 'get-invoice', 'billing')`).run();
    store.persist('endpoint', 'get-invoice');

    // Markdown in every markdown root of the registry: two `pages` roots, two system roots.
    const page = [
      '# Doc',
      '',
      '<tagged_list type="endpoint" tags="billing,auth"/>',
      '',
      '```',
      '<tagged_list type="endpoint" tags="billing"/>',
      '```',
      '',
    ].join('\n');
    const stores = new Map<string, MarkdownFileStore>();
    // 2.1.9: in the `skills` root (M52) a markdown file is a package file — `<package>/<file>`.
    const docOf = (kind: string): string => (kind === 'skills' ? 'pkg/doc.md' : 'doc.md');
    for (const root of registry.list().filter((r) => r.kind !== 'entities' && r.kind !== 'releases')) {
      fs.mkdirSync(path.join(cwd, root.dir, path.dirname(docOf(root.kind))), { recursive: true });
      fs.writeFileSync(path.join(cwd, root.dir, docOf(root.kind)), page);
      stores.set(root.id, new MarkdownFileStore({ cwd, rootId: root.id, dir: root.dir, kind: root.kind }));
    }
    // The propagation's root set, built as `buildProjectContext` builds it: the `references` flag.
    const referenceRoots = registry.withFlag('references');
    expect(referenceRoots.map((r) => r.kind)).toEqual(['pages', 'pages', 'skills']);
    const references = new ReferencesService(
      new Map(referenceRoots.map((r) => [r.id, stores.get(r.id)!])),
      new Map(),
    );

    tags.update('billing', { name: 'Invoicing' });
    const { changed } = await references.propagateTagSlugChange('billing', 'invoicing');

    // 1. Definition in tags.json of the `entities` root.
    const entitiesAbs = path.join(cwd, entitiesRoot.dir);
    const onDisk = JSON.parse(fs.readFileSync(path.join(entitiesAbs, 'tags.json'), 'utf8')) as Array<{ slug: string }>;
    expect(onDisk.map((t) => t.slug)).toEqual(['invoicing']);
    expect(fileMapEntryOf('entities', 'tags.json')?.track).toBe('HEAD');
    // 2. tags[] in the entity file `*/*.json` of the `entities` root.
    const entityFile = JSON.parse(fs.readFileSync(path.join(entitiesAbs, 'endpoint', 'get-invoice.json'), 'utf8')) as { tags: string[] };
    expect(entityFile.tags).toEqual(['invoicing']);
    expect(fileMapEntryOf('entities', 'endpoint/get-invoice.json')?.track).toBe('entity_version');
    // 3. tags="…" in the `references` roots only; a fenced tag is left as written.
    expect(changed).toEqual(['doc.md', 'doc.md', 'pkg/doc.md']);
    for (const root of referenceRoots) {
      const body = fs.readFileSync(path.join(cwd, root.dir, docOf(root.kind)), 'utf8');
      expect(body, root.id).toContain('<tagged_list type="endpoint" tags="invoicing,auth"/>');
      expect(body, root.id).toContain('```\n<tagged_list type="endpoint" tags="billing"/>\n```');
    }
    for (const kind of ['plans', 'briefs', 'patches'] as const) {
      expect(fs.readFileSync(path.join(cwd, registry.system(kind).dir, 'doc.md'), 'utf8'), kind).toBe(page);
    }
    db.close();
  });
});
