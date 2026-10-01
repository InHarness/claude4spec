import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E (brief 2-1-0-to-2-1-1): M20 editor behaviour stated as what the user sees.
 *
 * - `[ac:m20-picker-element-typ-ukryty-dostepny]` / `[ac:m20-picker-list-typ-bez-wiersza-niedostepny]`
 *   the type picker of `/element` offers the hidden `diagram`; the one of
 *   `/list` does not (a diagram has no list row).
 * - `[ac:m20-outline-click-scrolls-to-heading]` clicking a heading in the
 *   outline gutter scrolls the document to it.
 * - The outline toggle is absent in a root with `sectionIndexed: false`.
 * - `[ac:ac-ws-query-keys-edytora-z-mapowania-enti]` a `tagged_list` already on
 *   screen picks up an entity tagged AFTER the page was opened — through the
 *   `entity:changed` batch, with no reload.
 *
 * Every case asserts zero console errors and zero responses >= 400.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

async function firstProjectId(): Promise<string> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: Array<{ id: string }> };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project.id;
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

async function putPage(api: string, rootId: string, path: string, body: string): Promise<void> {
  const res = await fetch(`${api}/pages/${rootId}/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, expectedHash: 'a'.repeat(64) }),
  });
  if (![200, 201].includes(res.status)) throw new Error(`PUT ${rootId}/${path} → ${res.status}: ${await res.text()}`);
}

describe.skipIf(!BASE)('editor — brief 2.1.1', () => {
  let browser: Browser;
  let projectId: string;
  let api: string;
  const stamp = Math.random().toString(36).slice(2, 8);
  const pages: Array<[string, string]> = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    projectId = await firstProjectId();
    api = `${BASE}/api/projects/${projectId}`;
    await fetch(`${api}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });
  }, 60_000);

  afterAll(async () => {
    for (const [rootId, path] of pages) {
      await fetch(`${api}/pages/${rootId}/${path}`, { method: 'DELETE' }).catch(() => {});
    }
    await browser?.close();
  });

  async function openPage(rootId: string, path: string, body: string) {
    await putPage(api, rootId, path, body);
    pages.push([rootId, path]);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const watched = watch(page);
    await page.goto(`${BASE}/p/${projectId}/space/${rootId}/${path}`, { waitUntil: 'networkidle' });
    const editor = page.locator('.ProseMirror').first();
    await expect.poll(() => editor.count(), { timeout: 15_000 }).toBe(1);
    await sleep(1500); // let the non-blocking plugin boot settle
    return { page, editor, ...watched };
  }

  async function pickerOptions(page: Page, command: '/element' | '/list'): Promise<string[]> {
    await page.keyboard.type(command);
    const menu = page.locator('[data-slash-menu]');
    await expect.poll(() => menu.count(), { timeout: 5_000 }).toBe(1);
    await menu.locator('button', { hasText: command }).first().click();
    const select = page.locator('select').first();
    await expect.poll(() => select.count(), { timeout: 5_000 }).toBe(1);
    const options = await select.locator('option').evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
    await page.keyboard.press('Escape');
    return options;
  }

  it('[ac:m20-picker-element-typ-ukryty-dostepny] [ac:m20-picker-list-typ-bez-wiersza-niedostepny] /element offers diagram, /list does not', async () => {
    const path = `e2e-pickers-${stamp}.md`;
    const { page, editor, consoleErrors, badResponses } = await openPage('pages', path, `# Pickers ${stamp}\n\nText.\n`);
    try {
      await editor.locator('p').last().click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      const element = await pickerOptions(page, '/element');
      expect(element, `/element options: ${element.join(',')}`).toContain('diagram');

      await editor.locator('p').last().click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      const list = await pickerOptions(page, '/list');
      expect(list.length, `/list options: ${list.join(',')}`).toBeGreaterThan(0);
      expect(list, `/list options: ${list.join(',')}`).not.toContain('diagram');

      expect(consoleErrors, 'console errors').toEqual([]);
      expect(badResponses, 'responses >= 400').toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('[ac:m20-outline-click-scrolls-to-heading] clicking a heading in the outline gutter scrolls the document to it', async () => {
    const path = `e2e-outline-${stamp}.md`;
    const filler = Array.from({ length: 80 }, (_, i) => `Paragraph ${i} of filler text.`).join('\n\n');
    const { page, consoleErrors, badResponses } = await openPage(
      'pages',
      path,
      `# Outline ${stamp}\n\n${filler}\n\n## Far heading ${stamp}\n\nThe end.\n`,
    );
    try {
      const toggle = page.getByRole('button', { name: 'Outline', exact: true }).first();
      await expect.poll(() => toggle.count()).toBe(1);
      const nav = page.locator('nav[aria-label="Document outline"]');
      if ((await nav.count()) === 0) await toggle.click();
      await expect.poll(() => nav.count(), { timeout: 5_000 }).toBe(1);

      const target = page.locator('.ProseMirror h2', { hasText: `Far heading ${stamp}` });
      const before = (await target.boundingBox())!.y;
      expect(before, 'heading starts below the fold').toBeGreaterThan(900);
      await nav.locator('button', { hasText: `Far heading ${stamp}` }).click();
      await expect.poll(async () => (await target.boundingBox())!.y, { timeout: 5_000 }).toBeLessThan(900);

      expect(consoleErrors, 'console errors').toEqual([]);
      expect(badResponses, 'responses >= 400').toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('a root with sectionIndexed: false shows no outline toggle and no gutter', async () => {
    const rootId = `e2e-nosec-${stamp}`;
    const cfg = (await (await fetch(`${api}/config`)).json()) as { roots: Array<Record<string, unknown>> };
    const roots = cfg.roots;
    const patched = await fetch(`${api}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roots: [
          ...roots,
          {
            id: rootId,
            name: 'E2E no section index',
            dir: rootId,
            builtin: false,
            releasable: false,
            sectionIndexed: false,
            referenceValidated: false,
            linkTargets: ['pages'],
            sidebar: 'accordion',
            briefTarget: false,
          },
        ],
      }),
    });
    expect(patched.status, `PATCH config roots → ${await patched.clone().text()}`).toBeLessThan(300);
    const path = `nosec-${stamp}.md`;
    try {
      const { page, editor, consoleErrors, badResponses } = await openPage(rootId, path, `# No index\n\n## A heading\n\nText.\n`);
      try {
        await expect.poll(() => editor.innerText()).toContain('No index');
        expect(await page.getByRole('button', { name: 'Outline', exact: true }).count(), 'outline toggle').toBe(0);
        expect(await page.locator('nav[aria-label="Document outline"]').count(), 'outline gutter').toBe(0);
        expect(consoleErrors, 'console errors').toEqual([]);
        expect(badResponses, 'responses >= 400').toEqual([]);
      } finally {
        await page.close();
      }
    } finally {
      await fetch(`${api}/pages/${rootId}/${path}`, { method: 'DELETE' }).catch(() => {});
      const tracked = pages.findIndex(([r]) => r === rootId);
      if (tracked !== -1) pages.splice(tracked, 1);
      await fetch(`${api}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roots }),
      }).catch(() => {});
    }
  }, 90_000);

  it('[ac:ac-ws-query-keys-edytora-z-mapowania-enti] a tagged_list on screen shows an entity tagged after the page opened', async () => {
    const tag = `e2e-live-${stamp}`;
    const acSlug = `ac-live-${stamp}`;
    const path = `e2e-tagged-live-${stamp}.md`;
    const { page, editor, consoleErrors, badResponses } = await openPage(
      'pages',
      path,
      `# Live tagged list\n\n<tagged_list type="ac" tags="${tag}"/>\n`,
    );
    try {
      await expect.poll(() => editor.innerText()).toContain('Live tagged list');
      expect(await editor.innerText()).not.toContain(`Live criterion ${stamp}`);

      const created = await fetch(`${api}/acs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: acSlug, title: `Live criterion ${stamp}`, tags: [tag] }),
      });
      expect(created.status, await created.clone().text()).toBe(201);

      await expect.poll(() => editor.innerText(), { timeout: 10_000 }).toContain(`Live criterion ${stamp}`);

      expect(consoleErrors, 'console errors').toEqual([]);
      expect(badResponses, 'responses >= 400').toEqual([]);
    } finally {
      await page.close();
      await fetch(`${api}/acs/${acSlug}`, { method: 'DELETE' }).catch(() => {});
    }
  }, 60_000);
});
