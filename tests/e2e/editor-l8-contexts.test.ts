import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page, type Request } from 'playwright';

/**
 * E2E (0.2.85, brief 0-2-84-to-0-2-85): the L8 editor contexts behave per their
 * context spec, in a real browser.
 *
 * - `description` context (an entity's description field): the slash palette
 *   offers `/mention` and none of the page-only commands, and the field saves
 *   ON BLUR with a single-field `PATCH { description }` — not the debounced
 *   whole-draft save the rest of the panel uses. Before 0.2.85 the field
 *   mounted every registered extension and PATCHed the whole entity 500 ms
 *   after each keystroke.
 * - `page` context: autosave lands after `AUTOSAVE_DEBOUNCE_MS` (1000 ms) —
 *   not the earlier 500 ms — so a PUT is NOT observed 600 ms after typing and
 *   IS observed by 2500 ms.
 * - A hard load of a page that embeds a plugin-delivered entity renders the
 *   embed (no "unknown type" chip): the ordering invariant for the non-blocking
 *   plugin boot holds.
 *
 * Every case asserts zero console errors and zero responses >= 400.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
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
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
  });
  return { consoleErrors, badResponses };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!BASE)('editor L8 contexts', () => {
  let browser: Browser;
  let project: WorkspaceProject;
  const stamp = Math.random().toString(36).slice(2, 8);
  const endpointSlug = `e2e-l8-ctx-${stamp}`;
  const pagePath = `e2e-l8-ctx-${stamp}.md`;
  let api: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    api = `${BASE}/api/projects/${project.id}`;
    await fetch(`${api}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });
    const ep = await fetch(`${api}/endpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: endpointSlug,
        method: 'GET',
        path: `/e2e/l8/${stamp}`,
        summary: 'L8 context probe',
        description: 'initial',
      }),
    });
    if (ep.status !== 201) throw new Error(`POST /endpoints → ${ep.status}: ${await ep.text()}`);
    const pg = await fetch(`${api}/pages/pages/${pagePath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: `# L8 probe\n\nBefore <inline_mention type="endpoint" slug="${endpointSlug}"/> after.\n`,
        expectedHash: 'a'.repeat(64),
      }),
    });
    if (![200, 201].includes(pg.status)) throw new Error(`PUT page → ${pg.status}`);
  }, 60_000);

  afterAll(async () => {
    await fetch(`${api}/endpoints/${endpointSlug}`, { method: 'DELETE' }).catch(() => {});
    await fetch(`${api}/pages/pages/${pagePath}`, { method: 'DELETE' }).catch(() => {});
    await browser?.close();
  });

  it('description context: /mention only, saved on blur with a single-field PATCH', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);
    const patches: Array<{ url: string; body: unknown }> = [];
    page.on('request', (r: Request) => {
      if (r.method() === 'PATCH' && r.url().includes(`/endpoints/${endpointSlug}`)) {
        patches.push({ url: r.url(), body: r.postDataJSON() });
      }
    });

    await page.goto(`${BASE}/p/${project.id}/endpoints/${endpointSlug}`, { waitUntil: 'networkidle' });
    const editor = page.locator('.ProseMirror').first();
    await expect.poll(() => editor.count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => editor.innerText()).toContain('initial');

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    const rows = page.locator('[data-slash-menu] button');
    await expect.poll(() => rows.count()).toBeGreaterThan(0);
    const labels = (await rows.allInnerTexts()).map((t) => t.trim().split(/\s/)[0]);
    expect(labels, 'description palette offers /mention and nothing else').toEqual(['/mention']);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace'); // remove the typed "/"

    await page.keyboard.type(` typed-${stamp}`);
    // No whole-draft debounced save for the description: nothing lands while
    // the field keeps focus.
    await sleep(1500);
    expect(patches, 'PATCH before blur').toEqual([]);

    // Blur → exactly one PATCH carrying only `description`.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await expect.poll(() => patches.length, { timeout: 5_000 }).toBe(1);
    const body = patches[0]!.body as Record<string, unknown>;
    expect(Object.keys(body), 'PATCH payload keys').toEqual(['description']);
    expect(String(body.description)).toContain(`typed-${stamp}`);

    // A blur without an edit is not a write.
    await editor.click();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await sleep(800);
    expect(patches.length, 'PATCH after an edit-less blur').toBe(1);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  }, 60_000);

  it('page context: autosave debounces 1000 ms, not 500', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);
    const puts: number[] = [];
    page.on('request', (r: Request) => {
      if (r.method() === 'PUT' && r.url().includes(`/pages/pages/${pagePath}`)) puts.push(Date.now());
    });

    await page.goto(`${BASE}/p/${project.id}/space/pages/${pagePath}`, { waitUntil: 'networkidle' });
    const editor = page.locator('.ProseMirror').first();
    await expect.poll(() => editor.count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => editor.innerText()).toContain('L8 probe');

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' x');
    const typedAt = Date.now();
    await sleep(600);
    expect(puts, 'a PUT within 600 ms of the last keystroke').toEqual([]);
    await expect.poll(() => puts.length, { timeout: 4_000 }).toBeGreaterThan(0);
    expect(puts[0]! - typedAt, 'ms from keystroke to PUT').toBeGreaterThanOrEqual(950);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  }, 60_000);

  it('hard load of a page embedding a plugin entity renders the embed, not "unknown type"', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    await page.goto(`${BASE}/p/${project.id}/space/pages/${pagePath}`, { waitUntil: 'networkidle' });
    const editor = page.locator('.ProseMirror').first();
    await expect.poll(() => editor.count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => editor.innerText()).toContain('after');
    await sleep(1500); // let the non-blocking plugin boot settle
    const text = await editor.innerText();
    expect(text, 'embed rendered as a chip').not.toMatch(/unknown type/i);
    expect(text, 'the raw tag is not shown as text').not.toContain('<inline_mention');

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  }, 60_000);
});
