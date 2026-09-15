import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page, type Request } from 'playwright';

/**
 * E2E (0.2.88, brief 0-2-87-to-0-2-88): a 409 `PAGE_CONFLICT` on a page's
 * autosave opens the two-branch dialog — "Reload" adopts the server's copy,
 * "Keep my changes" overwrites it with a forced write guarded by the server's
 * current hash. Artifacts (brief, patch) keep their Reload-only banner; this
 * file covers pages.
 *
 * Producing a real conflict: the live-update socket is BLOCKED for the tab
 * (`routeWebSocket`), because an API write is broadcast with `origin: 'server'`
 * and a connected editor would silently refetch the new hash before its next
 * save — exactly the reconciliation that makes conflicts rare in practice. With
 * the socket down the editor's cached hash goes stale the moment the API writes,
 * and the next autosave 409s.
 *
 * Asserts zero console errors (the blocked socket's own connection message
 * excluded) and no responses >= 400 other than the expected 409.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

async function firstProject(): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: Array<{ id: string }> };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project;
}

function watch(page: Page, pagePath: string) {
  const consoleErrors: string[] = [];
  const badResponses: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/websocket/i.test(m.text())) consoleErrors.push(m.text());
  });
  page.on('response', (r) => {
    const expectedConflict = r.status() === 409 && r.url().includes(`/pages/pages/${pagePath}`);
    if (r.status() >= 400 && !expectedConflict) badResponses.push(`${r.status()} ${r.url()}`);
  });
  return { consoleErrors, badResponses };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!BASE)('page autosave conflict (409 PAGE_CONFLICT)', () => {
  let browser: Browser;
  let project: { id: string };
  let api: string;
  const stamp = Math.random().toString(36).slice(2, 8);
  const pagePath = `e2e-conflict-${stamp}.md`;

  const readPage = async (): Promise<{ body: string; hash: string }> => {
    const json = (await (await fetch(`${api}/pages/pages/${pagePath}`)).json()) as Record<string, unknown> & {
      data?: Record<string, unknown>;
    };
    const src = (json.data ?? json) as { body?: string; hash?: string };
    if (typeof src.body !== 'string' || typeof src.hash !== 'string') throw new Error(`unexpected page shape: ${JSON.stringify(json)}`);
    return { body: src.body, hash: src.hash };
  };

  const writeViaApi = async (body: string) => {
    const { hash } = await readPage();
    const res = await fetch(`${api}/pages/pages/${pagePath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, expectedHash: hash }),
    });
    if (![200, 201].includes(res.status)) throw new Error(`API PUT → ${res.status}: ${await res.text()}`);
  };

  /** Open the page with the live-update socket blocked; returns the editor + the PUT log. */
  const openStale = async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.routeWebSocket(/\/ws/, () => {
      /* never connect: the tab must not learn about the API write */
    });
    const observed = watch(page, pagePath);
    const puts: Array<{ status: number; body: Record<string, unknown> }> = [];
    page.on('response', async (r) => {
      if (r.request().method() === 'PUT' && r.url().includes(`/pages/pages/${pagePath}`)) {
        puts.push({ status: r.status(), body: (r.request() as Request).postDataJSON() as Record<string, unknown> });
      }
    });
    await page.goto(`${BASE}/p/${project.id}/space/pages/${pagePath}`, { waitUntil: 'networkidle' });
    const editor = page.locator('.ProseMirror').first();
    await expect.poll(() => editor.count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => editor.innerText()).toContain('Conflict probe');
    return { page, editor, puts, ...observed };
  };

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    api = `${BASE}/api/projects/${project.id}`;
    await fetch(`${api}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });
    const pg = await fetch(`${api}/pages/pages/${pagePath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: `# Conflict probe\n\nline one\n`, expectedHash: 'a'.repeat(64) }),
    });
    if (![200, 201].includes(pg.status)) throw new Error(`PUT page → ${pg.status}`);
  }, 60_000);

  afterAll(async () => {
    await fetch(`${api}/pages/pages/${pagePath}`, { method: 'DELETE' }).catch(() => {});
    await browser?.close();
  });

  it('[ac:page-conflict-reload] Reload adopts the server copy and discards the local edit', async () => {
    const { page, editor, puts, consoleErrors, badResponses } = await openStale();

    // Somebody else saves the page while this tab is not listening.
    await writeViaApi(`# Conflict probe\n\nline one\n\nserver-${stamp}\n`);

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(` local-${stamp}`);
    await expect.poll(() => puts.some((p) => p.status === 409), { timeout: 8_000 }).toBe(true);

    const dialogTitle = page.getByText('Page changed on the server');
    await expect.poll(() => dialogTitle.count(), { timeout: 5_000 }).toBe(1);
    await page.getByRole('button', { name: 'Reload' }).click();

    await expect.poll(() => editor.innerText(), { timeout: 8_000 }).toContain(`server-${stamp}`);
    expect(await editor.innerText(), 'local edit discarded').not.toContain(`local-${stamp}`);
    // No write was forced on Reload.
    await sleep(1500);
    expect(puts.filter((p) => p.status < 400), 'successful PUTs after Reload').toEqual([]);
    expect((await readPage()).body).not.toContain(`local-${stamp}`);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400 other than the 409').toEqual([]);
    await page.close();
  }, 60_000);

  it('[ac:page-conflict-keep-my-changes] Keep my changes overwrites the server copy immediately', async () => {
    const { page, editor, puts, consoleErrors, badResponses } = await openStale();

    await writeViaApi(`# Conflict probe\n\nline one\n\nserver2-${stamp}\n`);

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(` keep-${stamp}`);
    await expect.poll(() => puts.some((p) => p.status === 409), { timeout: 8_000 }).toBe(true);
    await expect.poll(() => page.getByText('Page changed on the server').count(), { timeout: 5_000 }).toBe(1);
    const before = puts.length;
    await page.getByRole('button', { name: 'Keep my changes' }).click();

    // A forced write, right after the confirmation — not a later autosave cycle.
    await expect.poll(() => puts.filter((p) => p.status < 400).length, { timeout: 5_000 }).toBeGreaterThan(0);
    const forced = puts.slice(before).find((p) => p.status < 400)!;
    expect(String(forced.body.body), 'forced write body').toContain(`keep-${stamp}`);
    const served = await readPage();
    expect(served.body).toContain(`keep-${stamp}`);
    expect(served.body, 'server copy overwritten').not.toContain(`server2-${stamp}`);
    expect(page.getByText('Page changed on the server'), 'dialog closed').toHaveCount(0);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400 other than the 409').toEqual([]);
    await page.close();
  }, 60_000);
});
