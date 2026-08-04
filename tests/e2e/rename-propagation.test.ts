import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: a rename repoints every reference, driven only by the `ref` flags.
 *
 * Host API 2.0.0 deleted the three `backend.onEntityRenamed` hooks and generates
 * one listener per module from its `data.schema` instead. The unit suite proves
 * the rewrite against in-memory databases; it cannot prove the listener is
 * REGISTERED, because registration happens in `synthesizeMount` during a real
 * `ProjectContext` boot that Vitest never performs.
 *
 * That is the failure this exists to catch, and it is invisible to every cheaper
 * check: a rename with no listener returns 200, the renamed entity is correct,
 * and only the OTHER entity — the one nobody looked at — silently keeps a slug
 * that no longer resolves. `curl`-ing the rename would report success.
 *
 * One case per physical shape a reference can have, because they share a
 * declaration and share nothing else:
 *   - a column on the entity row      — `ui-view.designSystemSlug`
 *   - a column in a projection table  — `endpoint.linkedDtos[].dto`
 *   - a value in embedded JSON        — `ac.verifies[].slug`, `ref: '$type'`
 *
 * Runs against a LIVE app (`C4S_E2E_BASE_URL`), normally an env-runner
 * environment built from the branch under test. Without that variable it skips.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

let projectId = '';
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

const send = (method: string) => (path: string, payload: unknown) =>
  api(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
const post = send('POST');
const patch = send('PATCH');

/** Every create in this file is namespaced by one stamp, so reruns never collide. */
const stamp = Date.now();
const p = (path: string) => `/api/projects/${projectId}${path}`;

describe.skipIf(!BASE)('rename propagation — end to end', () => {
  beforeAll(async () => {
    const ws = await api('/api/workspace');
    projectId = ws.body.projects?.[0]?.id;
    if (!projectId) throw new Error('no project registered in this environment');
    await patch(p('/config'), { onboardingCompleted: true });

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

  it('[ac:ac-rename-sluga-encji-propaguje-sie-do-wszy] a design-system rename repoints ui-view.designSystemSlug', async () => {
    const ds = await post(p('/design-systems'), { name: `Rename DS ${stamp}` });
    expect(ds.status).toBeLessThan(400);
    const view = await post(p('/ui-views'), {
      name: `Rename View ${stamp}`,
      url: '/rename/:id',
      designSystemSlug: ds.body.slug,
    });
    expect(view.status).toBeLessThan(400);

    const renamed = `${ds.body.slug}-renamed`;
    expect((await patch(p(`/design-systems/${ds.body.slug}`), { newSlug: renamed })).status).toBeLessThan(400);

    const after = await api(p(`/ui-views/${view.body.slug}`));
    expect(after.status).toBe(200);
    expect(after.body.designSystemSlug).toBe(renamed);
  });

  it('[ac:ac-rename-sluga-encji-propaguje-sie-do-wszy] a dto rename keeps the endpoint’s link resolvable', async () => {
    const dto = await post(p('/dtos'), {
      name: `RenameDto${stamp}`,
      fields: [{ name: 'id', type: 'string', required: true }],
    });
    const endpoint = await post(p('/endpoints'), {
      method: 'GET',
      path: `/rename/${stamp}`,
      summary: 'rename smoke',
    });
    expect((await post(p(`/endpoints/${endpoint.body.slug}/dtos`), {
      dtoSlug: dto.body.slug,
      relation: 'response',
      statusCode: 200,
    })).status).toBeLessThan(400);

    const renamed = `${dto.body.slug}-renamed`;
    expect((await patch(p(`/dtos/${dto.body.slug}`), { newSlug: renamed })).status).toBeLessThan(400);

    // Read from the DTO side: it is the end the junction does NOT bind, so a
    // link that survived only as a stale endpoint_slug would not show up here.
    const after = await api(p(`/dtos/${renamed}`));
    expect(after.status).toBe(200);
    expect(after.body.endpoints?.map((e: { endpointSlug: string }) => e.endpointSlug)).toContain(
      endpoint.body.slug,
    );
  });

  it('[ac:ac-pole-z-flaga-ref-typ-jest-rozpoznaw] an endpoint rename repoints ac.verifies[].slug', async () => {
    const endpoint = await post(p('/endpoints'), {
      method: 'POST',
      path: `/rename-verify/${stamp}`,
      summary: 'verify smoke',
    });
    const ac = await post(p('/acs'), {
      text: `Rename verify smoke ${stamp}`,
      verifies: [{ type: 'endpoint', slug: endpoint.body.slug }],
    });
    expect(ac.status).toBeLessThan(400);

    const renamed = `${endpoint.body.slug}-renamed`;
    expect((await patch(p(`/endpoints/${endpoint.body.slug}`), { newSlug: renamed })).status).toBeLessThan(400);

    const after = await api(p(`/acs/${ac.body.slug}`));
    expect(after.status).toBe(200);
    expect(after.body.verifies).toEqual([{ type: 'endpoint', slug: renamed }]);
    // And the reference is not merely rewritten but RESOLVABLE — `brokenVerifies`
    // is what item 25's existence check feeds, so a rewrite that pointed at
    // nothing would still pass the equality above.
    expect(after.body.brokenVerifies ?? []).toEqual([]);
  });

  it('produced no console errors and no responses >= 400', async () => {
    // Render the two pages whose content depends on a repointed reference, so a
    // rewrite that satisfied the API and broke the view is still caught.
    for (const path of ['/ui-views', '/acs']) {
      await page.goto(`${BASE}/p/${projectId}${path}`, { waitUntil: 'networkidle' });
      const text = await page.locator('body').innerText();
      expect(text.length, path).toBeGreaterThan(50);
      expect(text, path).not.toContain('Page not found');
    }
    expect(consoleErrors).toEqual([]);
    expect([...new Set(badResponses)]).toEqual([]);
  });
});
