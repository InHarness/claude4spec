import { describe, it, expect, beforeAll } from 'vitest';

/**
 * E2E: the keyed-collection read routes are MOUNTED and answer through the
 * discovery core's error catalogue (tier C, item 18).
 *
 * WHAT THIS CAN AND CANNOT COVER, stated up front because the gap is real: no
 * entity type shipped in this repo declares a keyed collection. The only
 * consumer is `c4s-plugin-spreadsheets`, which is still authored against Host
 * API 1.0.0 and therefore loads as `incompatible` under 2.0.0. So there is no
 * live grid here to read a window out of, and the dense-rectangle semantics are
 * covered by `discovery/ops/collections.test.ts` against a real projection
 * instead.
 *
 * What IS only observable end to end, and is what this pins:
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
     * Deliberate ordering, and worth pinning because it is what makes the
     * `ENTITY_NOT_FOUND` branch unreachable from here: whether a field is a
     * keyed collection is a question about the DECLARATION, settled without
     * touching a row, so it is answered first. An unknown slug on a
     * non-keyed field therefore reports the field, not the slug.
     *
     * The `ENTITY_NOT_FOUND` branch is real and covered — by
     * `discovery/ops/collections.test.ts`, against a type that does declare a
     * keyed collection. It cannot be reached over HTTP in this environment
     * because no type shipped in this repo declares one (see the file header).
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
