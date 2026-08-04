import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the GENERATED SQLite projection accepts real writes.
 *
 * Host API 2.0.0 deleted six hand-written `migrations.ts` files and generates
 * each type's tables from its `data.schema` instead. `projection.golden.test.ts`
 * proves the generated DDL is column-for-column identical to the retired DDL —
 * but it proves it about two in-memory databases, with nothing writing to them.
 *
 * WHY THAT IS NOT ENOUGH. The projection could be perfect and the write path
 * still fail, and nothing in Vitest would see it: the unit suite never boots the
 * app, so it never runs `applyProjection` against a real ProjectContext, never
 * exercises a REST create, and never renders a page off the resulting rows.
 * `curl` would not see it either — a create that 500s is visible, but a create
 * that succeeds while projecting nothing returns 201 and an empty list page that
 * also returns 200.
 *
 * So this creates an entity of every type through the real routes, reads each
 * back, links a DTO to an endpoint (the one table that is a generated projection
 * of a value collection rather than a column), and renders each type's pages
 * with zero tolerance for console errors or responses >= 400.
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

/**
 * `diagram` is deliberately absent from the PAGE cases, present in the API ones.
 * `src/client/router.tsx` defines routes for ui-views, design-systems and acs
 * plus plugin deep links for endpoints and dtos; a diagram is reached only as a
 * `<diagram/>` embed inside a page, so `/diagrams` legitimately lands on the
 * app's 404. Its projection is still exercised through create/read/count.
 */
const PAGED_TYPES = ['dto', 'endpoint', 'ui-view', 'ac', 'design-system'] as const;
const ALL_TYPES = [...PAGED_TYPES, 'diagram'] as const;

interface Created {
  prefix: string;
  slug: string;
}

let projectId = '';
const created: Partial<Record<(typeof ALL_TYPES)[number], Created>> = {};
let browser: Browser;
let page: Page;
const consoleErrors: string[] = [];
const badResponses: string[] = [];

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text.slice(0, 300) };
  }
}

const post = (path: string, payload: unknown) =>
  api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

/**
 * One create per type, chosen to exercise the parts of a schema the generator
 * has to get right rather than just "a row exists": an embedded value collection
 * (`dto.fields`, `ui-view.params`, `design-system.groups`), an enum with a
 * default (`diagram.format`), and a transient input that must NOT be persisted
 * (`diagram.caption`).
 */
function payloads(stamp: number) {
  return {
    dto: ['/dtos', { name: `SmokeDto${stamp}`, fields: [{ name: 'id', type: 'string', required: true }] }],
    endpoint: ['/endpoints', { method: 'GET', path: `/smoke/${stamp}`, summary: 'projection smoke' }],
    'ui-view': ['/ui-views', { name: `Smoke View ${stamp}`, url: '/smoke/:id', params: [{ name: 'id', in: 'path' }] }],
    ac: ['/acs', { text: `Projection smoke ${stamp}`, kind: 'requirement', status: 'active' }],
    'design-system': [
      '/design-systems',
      {
        name: `Smoke DS ${stamp}`,
        groups: [{ name: 'Core', tier: 'primitive', tokens: [{ name: 'brand', type: 'color', value: '#2563eb' }] }],
      },
    ],
    diagram: ['/diagrams', { source: 'graph TD; A-->B;', format: 'mermaid', caption: `Smoke ${stamp}` }],
  } as Record<(typeof ALL_TYPES)[number], [string, Record<string, unknown>]>;
}

describe.skipIf(!BASE)('generated SQLite projection — end to end', () => {
  beforeAll(async () => {
    const ws = await api('/api/workspace');
    projectId = ws.body.projects?.[0]?.id;
    if (!projectId) throw new Error('no project registered in this environment');
    await api(`/api/projects/${projectId}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });

    const stamp = Date.now();
    for (const [type, [prefix, payload]] of Object.entries(payloads(stamp))) {
      const res = await post(`/api/projects/${projectId}${prefix}`, payload);
      if (res.status === 200 || res.status === 201) {
        created[type as (typeof ALL_TYPES)[number]] = { prefix, slug: res.body.slug };
      }
    }

    browser = await chromium.launch();
    page = await browser.newPage();
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 400) badResponses.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  });

  it.each(ALL_TYPES)('%s: a create lands in the generated table and reads back', async (type) => {
    const entity = created[type];
    expect(entity, `create ${type} failed`).toBeDefined();
    const res = await api(`/api/projects/${projectId}${entity!.prefix}/${entity!.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe(entity!.slug);
  });

  it('a diagram does not persist its transient slug input', async () => {
    // `caption` carries `transientInput`, so it seeds the slug and never reaches
    // a column. A generator that projected it would round-trip it here.
    const entity = created.diagram!;
    const res = await api(`/api/projects/${projectId}/diagrams/${entity.slug}`);
    expect(res.body.caption).toBeUndefined();
  });

  it('links a DTO to an endpoint through the endpoint_dto projection', async () => {
    const res = await post(`/api/projects/${projectId}/endpoints/${created.endpoint!.slug}/dtos`, {
      dtoSlug: created.dto!.slug,
      relation: 'response',
      statusCode: 200,
    });
    expect(res.status).toBeLessThan(400);
    // Readable from BOTH ends — the junction is the only table generated from a
    // value collection rather than as a column, so a one-directional read would
    // hide half of it.
    const dto = await api(`/api/projects/${projectId}/dtos/${created.dto!.slug}`);
    expect(dto.body.endpoints?.map((e: { endpointSlug: string }) => e.endpointSlug)).toContain(
      created.endpoint!.slug,
    );
  });

  it('counts every active type without a missing table', async () => {
    // The walker that used to 500 the whole sidebar when one type had no table.
    const res = await api(`/api/projects/${projectId}/entities/counts`);
    expect(res.status).toBe(200);
    for (const type of ALL_TYPES) expect(res.body[type]).toBeGreaterThan(0);
  });

  it('reports every contributed type as ACTIVE, not merely loaded', async () => {
    const res = await api(`/api/projects/${projectId}/_meta/entities`);
    for (const type of ALL_TYPES) expect(res.body.active).toContain(type);
  });

  it.each(PAGED_TYPES)('%s: list and detail pages render real content', async (type) => {
    const entity = created[type]!;
    const url = `${BASE}/p/${projectId}${entity.prefix}`;

    for (const target of [url, `${url}/${entity.slug}`]) {
      await page.goto(target, { waitUntil: 'networkidle' });
      const text = await page.locator('body').innerText();
      // Both a white SPA shell and the router's not-found page return 200 and
      // settle on the right path, so length alone proves nothing — an earlier
      // draft of this check passed on "Page not found".
      expect(text.length, target).toBeGreaterThan(50);
      expect(text, target).not.toContain('Page not found');
    }
  });

  it('produced no console errors and no responses >= 400', () => {
    expect(consoleErrors).toEqual([]);
    expect([...new Set(badResponses)]).toEqual([]);
  });
});
