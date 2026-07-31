/**
 * 0.2.4 — one list order, on every transport.
 *
 * Before this, each surface answered "what is the list of X" differently: the
 * per-type service ordered by `name` (or `slug`, or `path, method`, or
 * `created_at DESC` for `ac`), while the discovery core re-sorted the reader's
 * output by `slug.localeCompare`. So the same entities came back in a different
 * order from REST than from MCP or the CLI, and `ac` reshuffled itself on every
 * boot because `created_at` was re-minted by the rebuild.
 *
 * The order is only meaningful because the timestamp now lives in the file:
 * that is what makes `created_at` stable across rebuilds and worth sorting on.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import { createDiscoveryCore } from '../../../src/server/discovery/index.js';
import { SerializationEngine } from '../../../src/server/core/plugin-host/serialization-engine.js';
import { sectionSerializer } from '../../../src/server/serialization/serializers/section.js';
import { builtinPagesRoot } from '../../../src/server/config.js';

function discoveryFor(t: TestApp) {
  return createDiscoveryCore({
    reader: t.rawReader,
    db: t.db,
    host: t.host,
    serialization: new SerializationEngine(t.host, sectionSerializer),
    roots: [builtinPagesRoot()],
    projectDir: t.cwd,
    packageVersion: 'test',
  });
}

describe('entity list order is unified', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  /**
   * Names are created in DESCENDING alphabetical order, so an alphabetical
   * ordering and a creation ordering disagree. Without that, every ordering
   * rule looks correct.
   */
  async function seedAcs(): Promise<string[]> {
    const slugs: string[] = [];
    for (const text of ['zebra criterion', 'middle criterion', 'alpha criterion']) {
      const res = await request(t.app).post('/api/acs').send({ text });
      expect(res.status).toBe(201);
      slugs.push(res.body.slug);
      // Distinct millisecond, so the assertion tests `created_at` rather than
      // silently falling through to the `slug` tiebreaker.
      await new Promise((r) => setTimeout(r, 2));
    }
    return slugs;
  }

  it('[ac:ac-porzadek-listy-encji-bez-zapytania-opier] REST returns entities oldest-first, not alphabetically', async () => {
    const created = await seedAcs();
    const res = await request(t.app).get('/api/acs');
    expect(res.status).toBe(200);
    const slugs = (res.body.acs as Array<{ slug: string }>).map((a) => a.slug);
    expect(slugs).toEqual(created);
    // Would have been the old `name`/alphabetical answer — pinned so a revert shows up.
    expect(slugs).not.toEqual([...created].sort());
  });

  it('[ac:ac-odczyt-generyczny-encji-lista-wiersz-p] the discovery core agrees with REST, with no re-sort of its own', async () => {
    const created = await seedAcs();
    const rest = await request(t.app).get('/api/acs');
    const restSlugs = (rest.body.acs as Array<{ slug: string }>).map((a) => a.slug);

    const result = discoveryFor(t).listEntities({ type: 'ac', view: 'element_list_item' });
    const coreSlugs = (result as { items: Array<{ slug: string }> }).items.map((i) => i.slug);

    expect(coreSlugs).toEqual(restSlugs);
    expect(coreSlugs).toEqual(created);
  });

  it('the order survives a page boundary — `slug` breaks ties so nothing is lost or repeated', async () => {
    await seedAcs();
    const core = discoveryFor(t);
    const first = core.listEntities({ type: 'ac', view: 'element_list_item', limit: 2 });
    const second = core.listEntities({ type: 'ac', view: 'element_list_item', limit: 2, offset: 2 });

    const page1 = (first as { items: Array<{ slug: string }> }).items.map((i) => i.slug);
    const page2 = (second as { items: Array<{ slug: string }> }).items.map((i) => i.slug);
    expect(new Set([...page1, ...page2]).size).toBe(3);
  });
});
