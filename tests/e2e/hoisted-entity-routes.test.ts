import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the host's own entity pages still work now that their routes are
 * contributed by the entity, not hardcoded in the router (0.2.16).
 *
 * `/acs`, `/ui-views` and `/design-systems` left `BASE_ROUTE_CHILDREN` and
 * became `RouteTreeFragment`s on their modules — because the plugin contract
 * now requires a `detailPanel` and its `routes` to be declared together. That
 * is a change no type check can validate: a fragment that fails to mount
 * produces a route that simply is not there, and the app answers with its
 * not-found screen rather than an error. Only a real browser against a real
 * boot can tell "the page rendered" from "the router had nothing for that URL".
 *
 * The console-error and failed-response assertions are the cheap half and the
 * likeliest to catch a regression: a detail page can paint its shell and still
 * be firing 404s behind it.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
}

const AC_SLUG = 'e2e-hoisted-route-ac';
const AC_TEXT = 'E2E HOISTED ROUTE AC';
const UI_VIEW_SLUG = 'e2e-hoisted-route-view';
const UI_VIEW_NAME = 'E2E HOISTED ROUTE VIEW';
const DS_SLUG = 'e2e-hoisted-route-ds';
const DS_NAME = 'E2E HOISTED ROUTE DS';

async function firstProject(): Promise<WorkspaceProject> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: WorkspaceProject[] };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project;
}

describe.skipIf(!BASE)('hoisted entity routes — list and detail pages still resolve', () => {
  let browser: Browser;
  let page: Page;
  let project: WorkspaceProject;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  const post = (path: string, body: unknown) =>
    fetch(`${BASE}/api/projects/${project.id}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    await fetch(`${BASE}/api/projects/${project.id}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });

    await post('acs', { slug: AC_SLUG, title: AC_TEXT });
    await post('ui-views', { slug: UI_VIEW_SLUG, title: UI_VIEW_NAME });
    await post('design-systems', { slug: DS_SLUG, title: DS_NAME });

    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // Same-origin only: a sandboxed container has no route to a web-font CDN,
    // and counting that 404 reports the environment's network policy as a bug.
    const ours = (url: string | undefined) => Boolean(url && url.startsWith(BASE!));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && ours(msg.location()?.url)) consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on('response', (res) => {
      if (res.status() >= 400 && ours(res.url())) failedResponses.push(`${res.status()} ${res.url()}`);
    });
  });

  afterAll(async () => {
    if (project) {
      const del = (path: string) =>
        fetch(`${BASE}/api/projects/${project.id}/${path}`, { method: 'DELETE' }).catch(() => {});
      await del(`acs/${AC_SLUG}`);
      await del(`ui-views/${UI_VIEW_SLUG}`);
      await del(`design-systems/${DS_SLUG}`);
    }
    await browser?.close();
  });

  /**
   * A DEEP LINK, not a click-through: a hard load is the case a missing route
   * actually breaks. The fragments are mounted synchronously before first paint
   * (unlike an external plugin's, which arrive after the boot), so there is no
   * "not contributed yet" window to wait out here — if the page needs one, the
   * hoist regressed.
   */
  const visit = async (path: string) => {
    await page.goto(`${BASE}/p/${project.id}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    return page.locator('body').innerText();
  };

  /**
   * A list identifies an entity by its text/name; a detail page identifies it by
   * SLUG in the breadcrumb and header. Asserting the right token per surface is
   * what makes "the page rendered" distinguishable from "the shell rendered" —
   * a not-found screen also answers 200 and also has a sidebar.
   */
  it('serves the ac list and detail from the module fragment', async () => {
    expect(await visit('/acs')).toContain(AC_TEXT);

    const detail = await visit(`/acs/${AC_SLUG}`);
    expect(detail).toContain(AC_SLUG);
    expect(detail).toMatch(/Details/i); // the detail panel itself, not just a heading
    expect(detail).not.toMatch(/not found/i);
  });

  it('serves the ac history route, the third path in the fragment', async () => {
    const history = await visit(`/acs/${AC_SLUG}/history`);
    expect(history).not.toMatch(/not found/i);
  });

  it('serves the ui-view list and detail from the module fragment', async () => {
    expect(await visit('/ui-views')).toContain(UI_VIEW_NAME);

    const detail = await visit(`/ui-views/${UI_VIEW_SLUG}`);
    expect(detail).toContain(UI_VIEW_NAME);
    expect(detail).not.toMatch(/not found/i);
  });

  it('serves the design-system list and detail from the module fragment', async () => {
    expect(await visit('/design-systems')).toContain(DS_NAME);

    const detail = await visit(`/design-systems/${DS_SLUG}`);
    expect(detail).toContain(DS_SLUG);
    expect(detail).toMatch(/token groups/i); // the design-system panel's own content
    expect(detail).not.toMatch(/not found/i);
  });

  it('keeps all three types in the sidebar — a hoisted route does not move the tab', async () => {
    await visit('/acs');
    const sidebar = await page.locator('nav, aside').first().innerText();
    expect(sidebar).toContain('Acceptance Criteria');
    expect(sidebar).toContain('UI Views');
    expect(sidebar).toContain('Design Systems');
    // Hidden types have no sidebarTab and must not have gained one.
    expect(sidebar).not.toContain('Diagrams');
  });

  it('logged no console errors and no failed same-origin responses', () => {
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
