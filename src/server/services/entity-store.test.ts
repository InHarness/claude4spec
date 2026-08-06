/**
 * `EntityStore`'s inbound path (0.2.11).
 *
 * `relPathFor` (outbound) has accepted any type since 2.0.0; `parseRelPath`
 * (inbound) is what decides whether a file under the entities root is an entity
 * file at all. The two must agree, or an entity can be written to disk and then
 * not recognised when it is read back — a change that never reindexes and a
 * deletion that never removes the row.
 *
 * Both cases below are regressions this file exists to prevent recurring: the
 * first shipped in 0.2.11's first draft (an ACTIVE-only gate), the second
 * predates it (an alphabet narrower than the store's own type rule).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { EntityStore } from './entity-store.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { SelfWriteSuppressor } from '../fs/sources.js';

/** `endpoint` and `oauth2-scope` are ACTIVE; `diagram` is installed but NOT. */
const AVAILABLE = ['endpoint', 'oauth2-scope', 'diagram'];
const ACTIVE = ['endpoint', 'oauth2-scope'];

const host = {
  listAvailable: () => AVAILABLE.map((type) => ({ type })),
  listEntities: () => ACTIVE.map((type) => ({ type })),
  getAvailable: (t: string) => (AVAILABLE.includes(t) ? { type: t } : null),
  getEntity: (t: string) => (ACTIVE.includes(t) ? { type: t } : null),
} as unknown as PluginHost;

describe('EntityStore.parseRelPath', () => {
  let dir: string;
  let store: EntityStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-store-'));
    store = new EntityStore(
      dir,
      'entities',
      { suppress: () => {} } as unknown as SelfWriteSuppressor,
      {} as unknown as RawEntityReader,
      host,
    );
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('recognises an active type', () => {
    expect(store.parseRelPath('endpoint/list-users.json')).toEqual({
      type: 'endpoint',
      slug: 'list-users',
    });
  });

  /**
   * The gate is activation-INDEPENDENT on purpose. `EntityIndexer.handleUnlink`
   * resolves the table through `getAvailable` precisely so a file removed while
   * its type is deactivated still has its row dropped — nothing else ever would,
   * since the rebuild skips inactive tables too. An ACTIVE-only gate here returns
   * null first, so that delete never runs and the entity keeps appearing in
   * `find_by_tag`, in `<tagged_list>` renders and in the sidebar the moment the
   * type is switched back on.
   */
  it('recognises a DEACTIVATED but installed type, so its deletions still reindex', () => {
    expect(store.parseRelPath('diagram/my-flow.json')).toEqual({
      type: 'diagram',
      slug: 'my-flow',
    });
  });

  /**
   * A type id is kebab-case with digits allowed (`KEBAB_RE`, and what
   * `normalizeEntityType` accepts). `relPathFor` writes `oauth2-scope/…` happily,
   * so an alphabet of `[a-z-]` here would strand every file it wrote.
   */
  it('recognises a type id containing digits, which relPathFor writes', () => {
    expect(store.relPathFor('oauth2-scope', 'read-write')).toBe('oauth2-scope/read-write.json');
    expect(store.parseRelPath('oauth2-scope/read-write.json')).toEqual({
      type: 'oauth2-scope',
      slug: 'read-write',
    });
  });

  it('rejects a path whose type no module contributes', () => {
    expect(store.parseRelPath('widget/thing.json')).toBeNull();
  });

  it('rejects paths that are not <type>/<slug>.json', () => {
    expect(store.parseRelPath('endpoint/nested/thing.json')).toBeNull();
    expect(store.parseRelPath('endpoint/thing.txt')).toBeNull();
    expect(store.parseRelPath('tags.json')).toBeNull();
  });

  /**
   * `listAll()` answers "what entity files are on disk", and a deactivated
   * type's files are still on disk. `project-context` compares this count with
   * the DB's to pick a migration direction, so undercounting sends it down the
   * wrong branch.
   */
  it('listAll includes a deactivated type’s files', () => {
    for (const [type, slug] of [
      ['endpoint', 'a'],
      ['diagram', 'b'],
    ]) {
      const p = path.join(dir, 'entities', type!, `${slug}.json`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, '{}');
    }
    expect(store.listAll().map((f) => f.relPath).sort()).toEqual([
      'diagram/b.json',
      'endpoint/a.json',
    ]);
  });
});
