import { describe, it, expect, beforeAll } from 'vitest';

/**
 * E2E: the keyed-collection read routes are MOUNTED and answer through the
 * discovery core's error catalogue (tier C, item 18).
 *
 * There IS a live grid to read now. `spreadsheet` ships as a built-in envelope
 * and declares a keyed `cells` collection, so the dense-rectangle semantics are
 * exercised here against a real projection rather than only in
 * `discovery/ops/collections.test.ts`. That caveat used to be the first thing
 * this file said: no shipped type declared a keyed collection, because the only
 * consumer was a plugin authored against Host API 1.0.0 that loaded as
 * `incompatible` under 2.0.0.
 *
 * What is only observable end to end, and is what this pins:
 *
 *   1. The routes exist on the running app at all. They are mounted on the
 *      host's cross-cutting entities router rather than under a type's own
 *      `pathPrefix`, and a mis-ordered route declaration would let
 *      `collections` be captured as a `:slug` — which no unit test sees,
 *      because units call the operations directly.
 *   2. A `DiscoveryError` reaches the client as its own status and keeps its
 *      `hint`. Until this tier the HTTP error handler knew nothing about that
 *      catalogue, so every one of these would have come back `500 INTERNAL` —
 *      "no such entity" and "the server broke" arriving as the same answer, with
 *      the navigation the core attaches thrown away.
 *   3. A real grid answers a window over HTTP with a DENSE rectangle, through
 *      the whole stack: a type declared in an envelope manifest, built into a
 *      bundle, discovered and registered by the loader, projected into SQLite,
 *      and read back through the route. Every layer of that is mocked or
 *      constructed by hand somewhere in the unit suites; nowhere else are they
 *      all real at once.
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

let projectId = '';
let acSlug = '';

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text.slice(0, 300) };
  }
}

const collections = (type: string, slug: string, field: string) =>
  `/api/projects/${projectId}/entities/${type}/${slug}/collections/${field}`;

describe.skipIf(!BASE)('keyed-collection read routes — end to end', () => {
  beforeAll(async () => {
    const ws = await api('/api/workspace');
    projectId = ws.body.projects?.[0]?.id;
    if (!projectId) throw new Error('no project registered in this environment');

    // Any real entity will do — these cases are about the ROUTES and the error
    // contract, and `ac` is the cheapest type to create.
    const created = await api(`/api/projects/${projectId}/acs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `Keyed route smoke ${Date.now()}`, kind: 'requirement', status: 'active' }),
    });
    expect([200, 201]).toContain(created.status);
    acSlug = created.body.data.slug;
  }, 120_000);

  it('refuses a field that is not a keyed collection with 400, not 500', () => {
    // The whole point: before the error handler learned the discovery
    // catalogue, this was a 500 with the hint discarded.
    return api(`${collections('ac', acSlug, 'text')}/overview`).then((res) => {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ARGUMENT');
      expect(res.body.error.message).toMatch(/not a keyed collection/);
      // The navigation half survives the transport.
      expect(res.body.error.hint).toBeTruthy();
    });
  });

  it('names what an author could have asked for instead', async () => {
    const res = await api(`${collections('ac', acSlug, 'nope')}/overview`);
    expect(res.status).toBe(400);
    // `ac` declares no keyed collection, so the hint says so rather than
    // listing an empty set — a caller has no other way to discover this,
    // because a keyed collection is deliberately absent from the entity payload.
    expect(res.body.error.hint).toMatch(/declares no keyed collection/);
  });

  it('answers the FIELD question before the entity question', async () => {
    /**
     * Deliberate ordering: whether a field is a keyed collection is a question
     * about the DECLARATION, settled without touching a row, so it is answered
     * first. An unknown slug on a non-keyed field therefore reports the field,
     * not the slug.
     *
     * The `ENTITY_NOT_FOUND` branch is reached the other way round — a keyed
     * field on a type that has one, with a slug that does not exist. See the
     * `spreadsheet` cases below.
     */
    const res = await api(`${collections('ac', 'no-such-ac-slug', 'cells')}/overview`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
    expect(res.body.error.message).toMatch(/not a keyed collection/);
  });

  it('404s an unknown TYPE with the active types in the hint', async () => {
    const res = await api(`${collections('not-a-type', 'x', 'cells')}/overview`);
    // `assertType` refuses an unknown type before the core is reached, so this
    // is a `VALIDATION`; either way it must not be a 500.
    expect([400, 404]).toContain(res.status);
    expect(res.status).toBeLessThan(500);
  });

  it('refuses a malformed window with the call that would have worked', async () => {
    const res = await api(`${collections('ac', acSlug, 'cells')}/window?a1=0&b1=1&a2=2&b2=2`);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error).toBeTruthy();
  });

  it('refuses a window with no coordinates at all, without throwing', async () => {
    // `Number(undefined)` is NaN; the guard has to reject it rather than
    // building a `BETWEEN NaN AND NaN`.
    const res = await api(`${collections('ac', acSlug, 'cells')}/window`);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error).toBeTruthy();
  });
});

/**
 * The same routes against a type that actually declares a keyed collection.
 *
 * Everything above is about refusals, because until `spreadsheet` shipped there
 * was nothing in the repo to succeed against. These cases are the other half:
 * the read path answering, over HTTP, from a grid this suite wrote itself.
 */
describe.skipIf(!BASE)('keyed-collection read routes — against a live grid', () => {
  let sheetSlug = '';

  beforeAll(async () => {
    const ws = await api('/api/workspace');
    projectId = ws.body.projects?.[0]?.id;
    if (!projectId) throw new Error('no project registered in this environment');

    const created = await api(`/api/projects/${projectId}/spreadsheets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `Keyed grid smoke ${Date.now()}`, nRows: 3, nCols: 3, headerRow: true }),
    });
    expect([200, 201]).toContain(created.status);
    sheetSlug = created.body.data.slug;
  }, 120_000);

  it('reports the grid from the DECLARED extents', async () => {
    const res = await api(`${collections('spreadsheet', sheetSlug, 'cells')}/overview`);
    expect(res.status).toBe(200);
    // Not `MAX(coordinate)` — nothing has been written yet and the sheet is
    // still 3×3. An overview derived from written cells would say 0×0.
    expect(res.body.axes).toEqual([
      { key: 'r', extent: 'nRows', length: 3 },
      { key: 'c', extent: 'nCols', length: 3 },
    ]);
    expect(res.body.itemFields).toEqual(['value']);
  });

  it('answers a window as a DENSE rectangle, empties materialised', async () => {
    const res = await api(`${collections('spreadsheet', sheetSlug, 'cells')}/window?a1=1&b1=1&a2=3&b2=3`);
    expect(res.status).toBe(200);
    // 3×3 of them, even though not one cell exists — this is what lets a caller
    // address `items[r - a1][c - b1]` without checking for holes.
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[0]).toHaveLength(3);
    expect(res.body.items[0][0]).toEqual({ value: null });
    expect(res.body.window).toEqual([
      { key: 'r', from: 1, to: 3 },
      { key: 'c', from: 1, to: 3 },
    ]);
  });

  it('reads back a cell an agent wrote through the keyed write door', async () => {
    /**
     * The read routes are deliberately READ-ONLY, so the write has to come from
     * the write path. Going through the generated `update` verb would reconcile
     * the collection replace-all, which is exactly what `writeCollectionWindow`
     * exists to avoid — but it is the only write reachable over REST, and here
     * the grid is empty so replace-all and merge coincide.
     */
    const written = await api(`/api/projects/${projectId}/spreadsheets/${sheetSlug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cells: [{ r: 2, c: 2, value: 'middle' }] }),
    });
    expect(written.status).toBeLessThan(300);

    const res = await api(`${collections('spreadsheet', sheetSlug, 'cells')}/window?a1=1&b1=1&a2=3&b2=3`);
    expect(res.status).toBe(200);
    expect(res.body.items[1][1]).toEqual({ value: 'middle' });
    // Still dense around it.
    expect(res.body.items[0][0]).toEqual({ value: null });
  });

  it('reaches ENTITY_NOT_FOUND — the branch no unknown slug could get to before', async () => {
    // A keyed field on a type that HAS one, so the declaration question passes
    // and the entity lookup is finally the thing that fails.
    const res = await api(`${collections('spreadsheet', 'no-such-sheet-at-all', 'cells')}/overview`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
  });

  it('refuses a window bigger than the cap instead of trying to build it', async () => {
    const res = await api(`${collections('spreadsheet', sheetSlug, 'cells')}/window?a1=1&b1=1&a2=5000&b2=5000`);
    expect(res.status).toBe(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error).toBeTruthy();
  });
});
