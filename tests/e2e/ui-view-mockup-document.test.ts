import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the mockup document — `GET /api/projects/:id/ui-views/:slug/mockup`.
 *
 * This file exists because the two things the release actually promises are
 * both invisible to `curl`. The first is that the document RENDERS: a `200`
 * with a `text/html` body proves the server answered, not that a browser made a
 * page out of it. The second is the isolation contract, which is only
 * observable from inside a real browsing context — `sandbox` without
 * `allow-same-origin` means `document.cookie` and `localStorage` THROW, and no
 * amount of header inspection demonstrates that.
 *
 * The top-level case is the important one. The detail panel's iframe carries a
 * `sandbox` attribute, so a test that only ever looked at the frame would pass
 * just as well with no header at all — and would keep passing after someone
 * "simplified" the route by dropping it. Opening the URL directly is the only
 * way to see that the HEADER is what does the work.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
}

async function firstProject(): Promise<WorkspaceProject> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: WorkspaceProject[] };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project;
}

function watch(page: Page) {
  const consoleErrors: string[] = [];
  const badResponses: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  return { consoleErrors, badResponses };
}

describe.skipIf(!BASE)('ui-view mockup document', () => {
  let browser: Browser;
  let project: WorkspaceProject;
  let slug: string;
  let api: string;

  const MOCKUP =
    '<main data-smoke="mockup"><h1 style="color: var(--brand)">Smoke Heading</h1>' +
    '<div data-preview-mode="dark"><p data-in-dark>dark subtree</p></div></main>';

  const json = (body: unknown) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  /**
   * Create, or accept that it is already there.
   *
   * The environment persists across runs, so a plain POST 409s the second time
   * and takes the whole suite down in `beforeAll` — where the failure reads as
   * "the feature is broken" rather than "the fixture already exists".
   */
  async function ensure(collection: string, body: { title: string }, expectedSlug: string) {
    const res = await fetch(`${api}/${collection}`, json(body));
    if (res.status === 201) return ((await res.json()) as { data: { slug: string } }).data.slug;
    return expectedSlug;
  }

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    api = `${BASE}/api/projects/${project.id}`;

    // A design system with a mode, so the sheet has both layers to show.
    await ensure(
      'design-systems',
      {
        title: 'Smoke DS',
        groups: [
          {
            name: 'Brand',
            tier: 'primitive',
            tokens: [{ name: 'brand', type: 'color', value: '#2563eb' }],
          },
        ],
        modes: [{ name: 'dark', overrides: [{ token: 'brand', value: '#93c5fd' }] }],
      } as never,
      'smoke-ds',
    );

    slug = await ensure(
      'ui-views',
      { title: 'Smoke View', designSystemSlug: 'smoke-ds' } as never,
      'smoke-view',
    );

    // Idempotent either way — the mockup is set by PATCH, not by create.
    await fetch(`${api}/ui-views/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mockupHtml: MOCKUP, designSystemSlug: 'smoke-ds' }),
    });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('renders the mockup as a real page, with the design system inlined', async () => {
    const page = await browser.newPage();
    const { consoleErrors, badResponses } = watch(page);
    await page.goto(`${api}/ui-views/${slug}/mockup`, { waitUntil: 'networkidle' });

    // Rendered CONTENT, not just a 200 — a blank document also returns one.
    await expect.poll(() => page.locator('h1').innerText()).toMatch(/Smoke Heading/);

    // The token reached the element through `:root`, so the sheet is inline and
    // applied — not merely present in the markup.
    const colour = await page.locator('h1').evaluate((el) => getComputedStyle(el).color);
    expect(colour).toBe('rgb(37, 99, 235)');

    /**
     * The mode block with no script at all: the element is inside
     * `[data-preview-mode="dark"]`, and custom properties inherit, so it takes
     * the override purely from the cascade.
     */
    const inDark = await page
      .locator('[data-in-dark]')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--brand').trim());
    expect(inDark).toBe('#93c5fd');

    expect(consoleErrors).toEqual([]);
    expect(badResponses).toEqual([]);
    await page.close();
  });

  it('is opaque-origin when opened top-level — the header, not an attribute', async () => {
    const page = await browser.newPage();
    await page.goto(`${api}/ui-views/${slug}/mockup`, { waitUntil: 'networkidle' });

    // In a sandbox without `allow-same-origin` both of these throw SecurityError.
    const probe = await page.evaluate(() => {
      const attempt = (fn: () => unknown): string => {
        try {
          fn();
          return 'allowed';
        } catch (e) {
          return (e as Error).name;
        }
      };
      return {
        origin: window.origin,
        storage: attempt(() => window.localStorage.length),
        cookie: attempt(() => document.cookie),
      };
    });

    expect(probe.origin).toBe('null');
    expect(probe.storage).toBe('SecurityError');
    expect(probe.cookie).toBe('SecurityError');
    await page.close();
  });

  it('serves a placeholder, never a browser error page, for a view with no mockup', async () => {
    const empty = await ensure('ui-views', { title: 'Empty Smoke View' }, 'empty-smoke-view');

    const page = await browser.newPage();
    const res = await page.goto(`${api}/ui-views/${empty}/mockup`, { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);
    await expect.poll(() => page.locator('[data-mockup-placeholder]').count()).toBe(1);
    await page.close();
  });

  /**
   * The tab strip, which is where the preview lives.
   *
   * It shipped as a 420px `FieldRow` inside the detail form and moved to its
   * own view in the same release; this case is what keeps that from silently
   * regressing into "the section is gone". A view is a ROUTE here, so the
   * assertions are on the URL as much as on the pixels.
   */
  it('switches DETAILS → PREVIEW → HISTORY from the topbar', async () => {
    const page = await browser.newPage();
    const { consoleErrors, badResponses } = watch(page);
    await page.goto(`${BASE}/p/${project.id}/ui-views/${slug}`, { waitUntil: 'networkidle' });

    // All three segments, and no leftover inline section on the detail form.
    for (const label of ['Details', 'Preview', 'History']) {
      await expect.poll(() => page.getByRole('button', { name: label, exact: true }).count()).toBe(1);
    }
    expect(await page.locator('iframe[title*="Mockup preview"]').count()).toBe(0);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/\/ui-views\/[^/]+\/preview$/);

    const frame = page.locator('iframe[title*="Mockup preview"]');
    await expect.poll(() => frame.count()).toBe(1);

    // Defense-in-depth, and it must stay narrow: same-origin would undo the point.
    expect(await frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-modals');

    // The frame actually painted the mockup, rather than sitting there empty.
    await expect
      .poll(() => page.frameLocator('iframe[title*="Mockup preview"]').locator('h1').innerText())
      .toMatch(/Smoke Heading/);

    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/\/ui-views\/[^/]+\/history$/);
    await expect.poll(() => frame.count()).toBe(0);

    expect(consoleErrors).toEqual([]);
    expect(badResponses).toEqual([]);
    await page.close();
  });

  /**
   * A deep link, because the active tab is derived from the URL and from
   * nothing else. If it were held in component state this would land on the
   * detail form with the wrong segment lit.
   */
  it('opens the preview tab directly by URL', async () => {
    const page = await browser.newPage();
    const { consoleErrors, badResponses } = watch(page);
    await page.goto(`${BASE}/p/${project.id}/ui-views/${slug}/preview`, { waitUntil: 'networkidle' });

    await expect
      .poll(() => page.getByRole('button', { name: 'Preview', exact: true }).getAttribute('aria-pressed'))
      .toBe('true');
    await expect
      .poll(() => page.frameLocator('iframe[title*="Mockup preview"]').locator('h1').innerText())
      .toMatch(/Smoke Heading/);

    expect(consoleErrors).toEqual([]);
    expect(badResponses).toEqual([]);
    await page.close();
  });

  /** The tab is never disabled — most views have no mockup, and that is normal. */
  it('keeps the preview tab usable for a view with no mockup', async () => {
    const empty = await ensure('ui-views', { title: 'Empty Smoke View' }, 'empty-smoke-view');
    const page = await browser.newPage();
    await page.goto(`${BASE}/p/${project.id}/ui-views/${empty}/preview`, { waitUntil: 'networkidle' });

    const tab = page.getByRole('button', { name: 'Preview', exact: true });
    await expect.poll(() => tab.isDisabled()).toBe(false);
    await expect
      .poll(() =>
        page.frameLocator('iframe[title*="Mockup preview"]').locator('[data-mockup-placeholder]').count(),
      )
      .toBe(1);
    await page.close();
  });
});
