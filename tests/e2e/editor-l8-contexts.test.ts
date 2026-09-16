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
 * - `description` context, palette pick by MOUSE: clicking a `/mention` row
 *   must not blur-save the half-typed palette query (`… /men`); the only PATCH
 *   is the final one, after the user leaves the field.
 * - `page` context: autosave lands after `AUTOSAVE_DEBOUNCE_MS` (1000 ms) —
 *   not the earlier 500 ms — so a PUT is NOT observed 600 ms after typing and
 *   IS observed by 2500 ms. Leaving the page INSIDE that window flushes the
 *   pending save instead of dropping it.
 * - A hard load of a page that embeds a plugin-delivered entity renders the
 *   embed (no "unknown type" chip): the ordering invariant for the non-blocking
 *   plugin boot holds.
 *
 * Brief 0-2-87-to-next (the context whitelist is authoritative, M20 `ctx4prof`):
 * - `[ac:ac-zapis-w-kontekscie-o-zawezonej-whitel]` a `<single_element/>` in a
 *   description — a tag whose node the `description` context does not mount —
 *   renders as a raw code node and comes back in the blur-save PATCH byte for
 *   byte instead of being dropped.
 * - `[ac:ac-opis-encji-zawierajacy-naglowki-h2-h6]` headings h2–h6, a list, a
 *   GFM task list and a table in a description survive the blur-save.
 * - A page under a user root with `referenceValidated: false` (the derived
 *   `page` context, L13) shows reference tags as raw code and autosaves them
 *   verbatim.
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
  const otherPagePath = `e2e-l8-ctx-${stamp}-other.md`;
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
    const other = await fetch(`${api}/pages/pages/${otherPagePath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: `# L8 other\n`, expectedHash: 'a'.repeat(64) }),
    });
    if (![200, 201].includes(other.status)) throw new Error(`PUT other page → ${other.status}`);
  }, 60_000);

  afterAll(async () => {
    await fetch(`${api}/endpoints/${endpointSlug}`, { method: 'DELETE' }).catch(() => {});
    await fetch(`${api}/pages/pages/${pagePath}`, { method: 'DELETE' }).catch(() => {});
    await fetch(`${api}/pages/pages/${otherPagePath}`, { method: 'DELETE' }).catch(() => {});
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

  it('description context: a mouse pick from the palette does not blur-save the query', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);
    const patches: Array<Record<string, unknown>> = [];
    page.on('request', (r: Request) => {
      if (r.method() === 'PATCH' && r.url().includes(`/endpoints/${endpointSlug}`)) {
        patches.push(r.postDataJSON() as Record<string, unknown>);
      }
    });

    await page.goto(`${BASE}/p/${project.id}/endpoints/${endpointSlug}`, { waitUntil: 'networkidle' });
    const editor = page.locator('.ProseMirror').first();
    await expect.poll(() => editor.count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => editor.innerText()).toContain('initial');

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(` pick-${stamp} /men`);
    const row = page.locator('[data-slash-menu] button').first();
    await expect.poll(() => row.count()).toBe(1);
    await row.click(); // mouse, not Enter — the path that used to blur the editor
    // The mention popover takes focus; that is not "leaving the field" either.
    await expect.poll(() => page.locator('[role="dialog"]').count(), { timeout: 5_000 }).toBe(1);
    await sleep(800);
    expect(patches, 'PATCH while the palette / popover had focus').toEqual([]);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('[role="dialog"]').count()).toBe(0);

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await expect.poll(() => patches.length, { timeout: 5_000 }).toBeGreaterThan(0);
    for (const body of patches) {
      expect(Object.keys(body), 'PATCH payload keys').toEqual(['description']);
      expect(String(body.description), 'palette query persisted').not.toContain('/men');
      expect(String(body.description)).toContain(`pick-${stamp}`);
    }

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  }, 60_000);

  it('page context: leaving the page inside the debounce window flushes the save', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);
    const puts: Array<Record<string, unknown>> = [];
    page.on('request', (r: Request) => {
      if (r.method() === 'PUT' && r.url().includes(`/pages/pages/${pagePath}`)) {
        puts.push(r.postDataJSON() as Record<string, unknown>);
      }
    });

    await page.goto(`${BASE}/p/${project.id}/space/pages/${pagePath}`, { waitUntil: 'networkidle' });
    const editor = page.locator('.ProseMirror').first();
    await expect.poll(() => editor.count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => editor.innerText()).toContain('L8 probe');

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(` flush-${stamp}`);
    // Client-side navigation well inside the 1000 ms window: the router
    // listens to popstate, so this unmounts the editor without a page load.
    await page.evaluate((href) => {
      history.pushState({}, '', href);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, `/p/${project.id}/space/pages/${otherPagePath}`);
    await expect.poll(() => editor.innerText(), { timeout: 10_000 }).toContain('L8 other');
    await expect.poll(() => puts.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(String(puts[puts.length - 1]!.body), 'flushed body').toContain(`flush-${stamp}`);
    const served = (await (await fetch(`${api}/pages/pages/${pagePath}`)).json()) as { body?: string; data?: { body?: string } };
    expect(JSON.stringify(served), 'server copy').toContain(`flush-${stamp}`);

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
  it('[ac:ac-zapis-w-kontekscie-o-zawezonej-whitel] description: an unmounted reference tag survives the blur-save verbatim', async () => {
    const tag = `<single_element type="endpoint" slug="${endpointSlug}"/>`;
    const seeded = `Lead text.\n\n${tag}\n\nTrailing <todo comment="keep me"/> text.\n`;
    const put = await fetch(`${api}/endpoints/${endpointSlug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: seeded }),
    });
    expect(put.status, 'seed PATCH').toBeLessThan(300);

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);
    const patches: Array<Record<string, unknown>> = [];
    page.on('request', (r: Request) => {
      if (r.method() === 'PATCH' && r.url().includes(`/endpoints/${endpointSlug}`)) {
        patches.push(r.postDataJSON() as Record<string, unknown>);
      }
    });

    await page.goto(`${BASE}/p/${project.id}/endpoints/${endpointSlug}`, { waitUntil: 'networkidle' });
    const editor = page.locator('.ProseMirror').first();
    await expect.poll(() => editor.count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => editor.innerText()).toContain('Lead text');
    // The whitelist decides what RENDERS: both tags show as raw code, not chips.
    const raw = editor.locator('.c4s-raw-jsx textarea, .c4s-raw-jsx input');
    await expect.poll(() => raw.count()).toBe(2);
    expect(await raw.nth(0).inputValue()).toBe(tag);
    expect(await raw.nth(1).inputValue()).toBe('<todo comment="keep me"/>');

    await editor.locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(` edited-${stamp}`);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await expect.poll(() => patches.length, { timeout: 5_000 }).toBe(1);
    const saved = String((patches[0] as { description?: unknown }).description);
    expect(saved).toContain(`edited-${stamp}`);
    // …and what SURVIVES the save: the exact bytes, no fence, no chip markup.
    expect(saved).toContain(tag);
    expect(saved).toContain('<todo comment="keep me"/>');
    expect(saved).not.toContain('```');
    const served = (await (await fetch(`${api}/endpoints/${endpointSlug}`)).json()) as { data?: { description?: string } };
    expect(String(served.data?.description ?? JSON.stringify(served))).toContain(tag);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  }, 60_000);

  it('[ac:ac-opis-encji-zawierajacy-naglowki-h2-h6] description: h2–h6, a list and a table pass through the blur-save', async () => {
    const lines = [
      '## Two',
      '### Three',
      '#### Four',
      '##### Five',
      '###### Six',
      '',
      '- alpha',
      '- beta',
      '',
      'Tasks:',
      '',
      '- [ ] open task',
      '- [x] done task',
      '',
      '| col a | col b |',
      '| --- | --- |',
      '| cell 1 | cell 2 |',
      '',
    ];
    const put = await fetch(`${api}/endpoints/${endpointSlug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: lines.join('\n') }),
    });
    expect(put.status, 'seed PATCH').toBeLessThan(300);

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);
    const patches: Array<Record<string, unknown>> = [];
    page.on('request', (r: Request) => {
      if (r.method() === 'PATCH' && r.url().includes(`/endpoints/${endpointSlug}`)) {
        patches.push(r.postDataJSON() as Record<string, unknown>);
      }
    });

    await page.goto(`${BASE}/p/${project.id}/endpoints/${endpointSlug}`, { waitUntil: 'networkidle' });
    const editor = page.locator('.ProseMirror').first();
    await expect.poll(() => editor.count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => editor.innerText()).toContain('cell 2');
    for (const [sel, text] of [['h2', 'Two'], ['h3', 'Three'], ['h4', 'Four'], ['h5', 'Five'], ['h6', 'Six']]) {
      // textContent, not innerText: the theme upper-cases some heading levels via CSS.
      expect(await editor.locator(sel!).evaluate((el) => el.textContent), `${sel} rendered as a heading`).toBe(text);
    }
    expect(await editor.locator('table td, table th').count(), 'table cells').toBe(4);
    // GFM task list parsed as one (rule 7), not as a bullet whose text starts with `[ ]`.
    expect(await editor.locator('input[type="checkbox"]').count(), 'task checkboxes').toBe(2);

    // Edit the last table cell so the whole document is re-serialized on blur.
    await editor.locator('table td').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type(` z${stamp}`);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await expect.poll(() => patches.length, { timeout: 5_000 }).toBe(1);
    const saved = String((patches[0] as { description?: unknown }).description);
    for (const line of ['## Two', '### Three', '#### Four', '##### Five', '###### Six', '- alpha', '- beta', '- [ ] open task', '- [x] done task']) {
      expect(saved, `line kept: ${line}`).toContain(line);
    }
    expect(saved, 'task brackets not escaped').not.toContain('\\[');
    expect(saved).toMatch(/\|\s*col a\s*\|\s*col b\s*\|/);
    expect(saved).toMatch(new RegExp(`\\|\\s*cell 1\\s*\\|\\s*cell 2 z${stamp}\\s*\\|`));
    expect(saved).not.toMatch(/^# /m); // no heading got promoted to h1

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  }, 60_000);

  it('page context derived from root props: a non-validated user root shows reference tags as raw code and autosaves them verbatim', async () => {
    const rootId = `e2e-min-${stamp}`;
    const cfg = (await (await fetch(`${api}/config`)).json()) as { roots: Array<Record<string, unknown>> };
    const roots = cfg.roots;
    expect(Array.isArray(roots) && roots.length > 0, 'config.roots').toBe(true);
    const withRoot = [
      ...roots,
      {
        id: rootId,
        name: 'E2E minimal root',
        dir: rootId,
        builtin: false,
        releasable: false,
        sectionIndexed: false,
        referenceValidated: false,
        linkTargets: ['pages'],
        sidebar: 'accordion',
        briefTarget: false,
      },
    ];
    const patched = await fetch(`${api}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roots: withRoot }),
    });
    expect(patched.status, `PATCH config roots → ${await patched.clone().text()}`).toBeLessThan(300);
    const minPath = `min-${stamp}.md`;
    const tag = `<single_element type="endpoint" slug="${endpointSlug}"/>`;
    const mention = `<inline_mention type="endpoint" slug="${endpointSlug}"/>`;
    try {
      const pg = await fetch(`${api}/pages/${rootId}/${minPath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: `# Minimal root\n\nInline ${mention} here.\n\n${tag}\n`,
          expectedHash: 'a'.repeat(64),
        }),
      });
      expect([200, 201], `PUT page under ${rootId}`).toContain(pg.status);

      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { consoleErrors, badResponses } = watch(page);
      const puts: Array<Record<string, unknown>> = [];
      page.on('request', (r: Request) => {
        if (r.method() === 'PUT' && r.url().includes(`/pages/${rootId}/${minPath}`)) {
          puts.push(r.postDataJSON() as Record<string, unknown>);
        }
      });

      await page.goto(`${BASE}/p/${project.id}/space/${rootId}/${minPath}`, { waitUntil: 'networkidle' });
      const editor = page.locator('.ProseMirror').first();
      await expect.poll(() => editor.count(), { timeout: 15_000 }).toBe(1);
      await expect.poll(() => editor.innerText()).toContain('Minimal root');
      await sleep(1500); // let the non-blocking plugin boot settle
      const raw = editor.locator('.c4s-raw-jsx textarea, .c4s-raw-jsx input');
      await expect.poll(() => raw.count()).toBe(2);
      expect(await raw.nth(0).inputValue()).toBe(mention);
      expect(await raw.nth(1).inputValue()).toBe(tag);
      expect(await editor.innerText()).not.toMatch(/unknown type/i);

      await editor.locator('h1').click();
      await page.keyboard.press('End');
      await page.keyboard.type(` v${stamp}`);
      await expect.poll(() => puts.length, { timeout: 5_000 }).toBeGreaterThan(0);
      const body = String(puts[puts.length - 1]!.body);
      expect(body).toContain(`Minimal root v${stamp}`);
      expect(body).toContain(mention);
      expect(body).toContain(tag);
      expect(body).not.toContain('```');

      // The `/` palette follows the schema: a root without reference
      // validation / section indexing offers neither `/mention` nor
      // `/section` (their nodes are not mounted — a pick would insert
      // nothing), while `/todo` stays.
      await page.keyboard.press('Enter');
      await page.keyboard.type('/');
      const menu = page.locator('[data-slash-menu]');
      await expect.poll(() => menu.count(), { timeout: 5_000 }).toBe(1);
      const offered = await menu.locator('button > span:first-child').evaluateAll((els) => els.map((el) => el.textContent ?? ''));
      expect(offered.some((t) => /todo/i.test(t)), `offers /todo: ${offered.join(' | ')}`).toBe(true);
      expect(offered.some((t) => /mention/i.test(t)), `hides /mention: ${offered.join(' | ')}`).toBe(false);
      expect(offered.some((t) => /section/i.test(t)), `hides /section: ${offered.join(' | ')}`).toBe(false);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Backspace');

      expect(consoleErrors, 'console errors').toEqual([]);
      expect(badResponses, 'responses >= 400').toEqual([]);
      await page.close();
    } finally {
      await fetch(`${api}/pages/${rootId}/${minPath}`, { method: 'DELETE' }).catch(() => {});
      await fetch(`${api}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roots }),
      }).catch(() => {});
    }
  }, 90_000);
});
