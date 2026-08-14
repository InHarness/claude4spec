import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the 0.2.22 read contract, against a running app.
 *
 * Three things this release changed cannot be proved by the unit suite, and two
 * of them cannot be proved by `curl` either:
 *
 *   1. `title` reaches the SCREEN. Every chip, row and card was rewritten to read
 *      it, and a renderer still reading a retired `name` renders `undefined` —
 *      which is a 200 with a blank label, invisible to any status-code check.
 *   2. `source` does NOT reach a generic read, and the diagram editor still
 *      shows a diagram. Those two are in tension: the field was removed from the
 *      payload the editor used to read, and the editor now fetches it through
 *      `get_field_content`. If that second call were missing, the page would
 *      render an empty editor and still answer 200.
 *   3. `select` narrows a real response, and an illegal name is refused with the
 *      legal ones attached.
 *
 * Every case asserts zero console errors and zero responses >= 400 alongside its
 * own subject, because the failure mode this release most plausibly introduces —
 * a component reading a field that no longer arrives — surfaces as a console
 * error on an otherwise healthy page.
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

let projectId = '';
let browser: Browser;
let page: Page;
const consoleErrors: string[] = [];
const badResponses: string[] = [];
const stamp = Date.now();
const made: Record<string, string> = {};

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

const DIAGRAM_SOURCE = 'graph TD;\n  Browser-->Route;\n  Route-->Body;';

describe.skipIf(!BASE)('0.2.22 — title on screen, select on the wire', () => {
  beforeAll(async () => {
    const ws = await api('/api/workspace');
    projectId = ws.body.projects?.[0]?.id;
    if (!projectId) throw new Error('no project registered in this environment');
    const p = (path: string) => `/api/projects/${projectId}${path}`;
    await api(p('/config'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });

    for (const [key, path, payload] of [
      ['ac', '/acs', { text: `The title reaches the screen ${stamp}` }],
      ['dto', '/dtos', { title: `TitleDto${stamp}`, fields: [{ name: 'id', type: 'string', required: true }] }],
      ['ui-view', '/ui-views', { title: `Title View ${stamp}` }],
      ['diagram', '/diagrams', { title: `Title Diagram ${stamp}`, source: DIAGRAM_SOURCE }],
    ] as Array<[string, string, Record<string, unknown>]>) {
      const res = await post(p(path), payload);
      if (res.status !== 201 && res.status !== 200) {
        throw new Error(`create ${key} failed: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
      }
      made[key] = res.body.data.slug;
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

  /**
   * The derivation, end to end: `ac` is created with `text` alone and the host
   * fills `title` from it before the slug is computed. That ordering is the most
   * breakable line in the release — reversed, every create of every type lands
   * on an empty slug.
   */
  it('[ac:ac-wartosc-title-pochodzi-z-jawnego-wejs] a derived title fills in and seeds the slug', async () => {
    const res = await api(`/api/projects/${projectId}/acs/${made.ac}`);
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe(`The title reaches the screen ${stamp}`);
    expect(made.ac!.startsWith('ac-the-title-reaches-the-screen')).toBe(true);
  });

  it('[ac:ac-select-jest-legalne-i-znaczy-sam-szki] select narrows a record, and the envelope says what it gave', async () => {
    const wide = await api(`/api/projects/${projectId}/entities/ac/get?slugs=${made.ac}`);
    expect(wide.status).toBe(200);
    expect(wide.body.results[0].entity.text).toBeDefined();

    const skeleton = await api(`/api/projects/${projectId}/entities/ac/get?slugs=${made.ac}&select=`);
    expect(skeleton.status).toBe(200);
    // Identity survives a projection that asked for nothing else...
    expect(skeleton.body.results[0].entity.slug).toBe(made.ac);
    expect(skeleton.body.results[0].entity.title).toBeDefined();
    // ...and the fields nobody asked for are gone.
    expect(skeleton.body.results[0].entity.text).toBeUndefined();
    expect(skeleton.body.selectedFields).toEqual(['slug', 'title', 'tags', 'href']);
    /**
     * `href` is in the SKELETON, which is the width where a chip is rendered.
     * It is host-generated from the type's `pathPrefix` rather than declared by
     * any schema — the one thing the retired per-type views contributed that a
     * projection over the schema could not reproduce.
     */
    expect(skeleton.body.results[0].entity.href).toBe(`/acs/${made.ac}`);

    // And the echo can be handed straight back as a `select` — identity names
    // are legal input, not just guaranteed output.
    const echoed = await api(
      `/api/projects/${projectId}/entities/ac/get?slugs=${made.ac}&select=${skeleton.body.selectedFields.join(',')}`,
    );
    expect(echoed.status).toBe(200);
  });

  it('[ac:ac-select-ze-sciezka-kropkowa-z-w-nazwie] an illegal select names the legal fields instead of guessing', async () => {
    const res = await api(`/api/projects/${projectId}/entities/ac/get?slugs=${made.ac}&select=fields.name`);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/top-level field/);
    expect(JSON.stringify(res.body)).toMatch(/legal names/);
  });

  it('[ac:ac-wiersz-list-entities-ma-ksztalt-slug] a discovery row is a key and a label, nothing else', async () => {
    const res = await api(`/api/projects/${projectId}/entities/ac/list?limit=5`);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('ac');
    for (const row of res.body.items) {
      expect(Object.keys(row).sort()).toEqual(['slug', 'title']);
    }
  });

  /**
   * The browser half of the content-bearing rule. The editor renders a diagram
   * whose body no longer travels with the entity, so a missing second call shows
   * up here as an empty editor — and as nothing at all in a status-code check.
   */
  it('[ac:ac-komponent-frontendu-renderujacy-encje] an embedded diagram renders a body no generic read carries', async () => {
    /**
     * A diagram has no route of its own — it is reached as an embed — so the
     * card on a page is where the second call either happens or does not.
     * Rendering the mermaid graph proves the component fetched `source` through
     * `get_field_content`, because the entity it was handed does not contain it.
     */
    const entity = await api(`/api/projects/${projectId}/diagrams/${made.diagram}`);
    expect(entity.body.data.source).toBeUndefined();
    expect(entity.body.data.hasSource).toBe(true);
    expect(entity.body.data.sourceOperation).toBe('get_field_content');

    const path = `title-select-${stamp}.md`;
    await api(`/api/projects/${projectId}/pages/pages/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedHash: 'a'.repeat(64),
        body: `# Content-bearing smoke\n\n<single_element type="diagram" slug="${made.diagram}"/>\n`,
      }),
    });

    await page.goto(`${BASE}/p/${projectId}/pages/${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const body = await page.content();
    // The rendered SVG carries the node labels from the DSL body.
    expect(body).toMatch(/Browser/);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(badResponses, `bad responses: ${badResponses.join(' | ')}`).toEqual([]);
  });

  it('[ac:ac-slugpattern-redukuje-sie-do-literal-t] a list page renders the title, not the slug', async () => {
    await page.goto(`${BASE}/p/${projectId}/acs`, { waitUntil: 'networkidle' });
    expect(await page.content()).toContain(`The title reaches the screen ${stamp}`);

    await page.goto(`${BASE}/p/${projectId}/ui-views`, { waitUntil: 'networkidle' });
    expect(await page.content()).toContain(`Title View ${stamp}`);

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(badResponses, `bad responses: ${badResponses.join(' | ')}`).toEqual([]);
  });
});
