import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: `endpoint` and `dto` still work after moving into a builtin envelope.
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe to run
 * anywhere.
 *
 * WHY THIS EXISTS AS AN E2E RATHER THAN A UNIT TEST. Release 0.2.2 moved these
 * two types out of the host and into `plugins/c4s-plugin-api-contracts`, served
 * to the browser as a plugin bundle. Three separate bugs shipped past a green
 * 1049-test suite and a clean typecheck during that change, and not one of them
 * was reachable from Vitest:
 *
 *   1. The built envelope never reached the runtime image, so the types simply
 *      did not exist. `discoverBuiltinEnvelopes()` returns `[]` on a missing
 *      artifact — no error, no warning, no failing request.
 *   2. A deactivated type lost its table, so `GET /entities/counts` threw and
 *      returned 500 — blanking every badge in the sidebar, not just its own.
 *   3. The detail page threw on every render because a host lookup had been
 *      pulled into a local, unbinding `this`. It type-checks perfectly.
 *
 * All three are invisible to `curl` too: (1) and (3) return 200 with an HTML
 * shell. What catches them is a real browser reaching a real rendered page, and
 * a zero-tolerance rule on console errors.
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
  if (!project) throw new Error('no project registered in this environment');
  await fetch(`${BASE}/api/projects/${project.id}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ onboardingCompleted: true }),
  });
  return project;
}

/** Console errors and >=400 responses, collected for the whole page lifetime. */
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

describe.skipIf(!BASE)('envelope-contributed entity pages', () => {
  let browser: Browser;
  let project: WorkspaceProject;

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
  });
  afterAll(async () => {
    await browser?.close();
  });

  const TYPES = [
    { type: 'endpoint', path: 'endpoints', heading: /Endpoints/ },
    { type: 'dto', path: 'dtos', heading: /DTOs/ },
  ] as const;

  for (const { type, path, heading } of TYPES) {
    it(`[ac:ac-pilotowa-koperta-wbudowana-c4s-plugin-a] ${type} list renders from the envelope bundle`, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { consoleErrors, badResponses } = watch(page);

      await page.goto(`${BASE}/p/${project.id}/${path}`, { waitUntil: 'networkidle' });

      // The header's own result count — proof the query resolved, not merely
      // that a shell painted. Polled, because the plugin bundle boots after
      // first paint and the route does not exist until it does.
      await expect.poll(() => page.locator('body').innerText()).toMatch(heading);
      await expect.poll(() => page.locator('body').innerText()).toMatch(/\d+\s+results?/i);

      expect(consoleErrors, 'console errors').toEqual([]);
      expect(badResponses, 'responses >= 400').toEqual([]);
      await page.close();
    });
  }

  it('[ac:ac-pilotowa-koperta-wbudowana-c4s-plugin-a] the endpoint detail page renders, junction included', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    // Pick a seeded endpoint that actually has a linked DTO, so the assertion
    // below is about the junction rather than about an empty section.
    const res = await fetch(`${BASE}/api/projects/${project.id}/endpoints`);
    const { endpoints } = (await res.json()) as {
      endpoints: Array<{ slug: string; dtos: Array<{ dtoName: string }> }>;
    };
    const linked = endpoints.find((e) => e.dtos.length > 0);
    if (!linked) {
      // Seed-shaped, not a behaviour failure — say so rather than passing quietly.
      console.warn('[e2e] no endpoint with a linked DTO in this environment — junction not exercised');
      await page.close();
      return;
    }

    await page.goto(`${BASE}/p/${project.id}/endpoints/${linked.slug}`, { waitUntil: 'networkidle' });

    // The breadcrumb bar is the component that threw on bug (3) above; its
    // presence, not merely the URL, is the assertion.
    await expect.poll(() => page.locator('body').innerText()).toMatch(linked.slug);
    // The junction, resolved by the envelope's own SQL.
    await expect
      .poll(() => page.locator('body').innerText())
      .toMatch(new RegExp(linked.dtos[0]!.dtoName));

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });

  it('[ac:ac-pilotowa-koperta-wbudowana-c4s-plugin-a] a detail deep link survives a hard refresh', async () => {
    // Plugin frontends boot after first paint, so a plugin-contributed route
    // does not exist when a hard refresh lands. Rendering "not found" there
    // reports a working link as broken.
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    const res = await fetch(`${BASE}/api/projects/${project.id}/endpoints`);
    const { endpoints } = (await res.json()) as { endpoints: Array<{ slug: string }> };
    const slug = endpoints[0]?.slug;
    if (!slug) throw new Error('environment has no endpoint to exercise — seed one first');

    await page.goto(`${BASE}/p/${project.id}/endpoints/${slug}`, { waitUntil: 'networkidle' });

    // Poll FOR the page, never against the failure.
    //
    // `expect.poll` retries until the assertion PASSES, so a negative matcher is
    // satisfied by the first sample — including the pre-hydration shell, which
    // contains no text at all and therefore no "not found" either. Written that
    // way this case went green with the `defaultNotFoundComponent` fix reverted,
    // i.e. it could not fail for the reason it exists.
    //
    // Waiting for the slug to appear is a positive condition that only the
    // rendered detail page satisfies, so the not-found path fails it by timing
    // out. The negative check then runs on settled content and is meaningful.
    await expect.poll(() => page.locator('body').innerText()).toMatch(slug);
    expect(await page.locator('body').innerText()).not.toMatch(/not found/i);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });

  /**
   * The pane a route body sits in must be the host's `RoutePane` — a flex
   * column that does not scroll — so the body's own scroll container engages.
   *
   * The envelope's copy dropped `display: flex` and added `overflow: auto`,
   * which reads like a simplification and silently unmakes every `flex-1` child.
   * Nothing errors; the page just scrolls in the wrong element, and the
   * breadcrumb bar and list header slide out of the viewport instead of staying
   * pinned. Only a rendered, scrolled page can tell the difference.
   */
  it('[ac:ac-pilotowa-koperta-wbudowana-c4s-plugin-a] the detail body scrolls under a pinned breadcrumb bar', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
    const { consoleErrors, badResponses } = watch(page);

    const res = await fetch(`${BASE}/api/projects/${project.id}/endpoints`);
    const { endpoints } = (await res.json()) as { endpoints: Array<{ slug: string }> };
    const slug = endpoints[0]?.slug;
    if (!slug) throw new Error('environment has no endpoint to exercise — seed one first');

    await page.goto(`${BASE}/p/${project.id}/endpoints/${slug}`, { waitUntil: 'networkidle' });
    const bar = page.locator('text=Details').first();
    await expect.poll(() => bar.count()).toBe(1);

    const before = await bar.boundingBox();
    await page.mouse.move(700, 600);
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(600);
    const after = await bar.boundingBox();

    expect(before, 'breadcrumb bar before scrolling').not.toBeNull();
    expect(after?.y, 'breadcrumb bar y after scrolling the body').toBeCloseTo(before!.y, 0);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });

  /**
   * The slash palette offers each of the envelope's commands EXACTLY ONCE, and
   * the entry describes itself.
   *
   * Two regressions met here. The frontend module contributed a second entry
   * carrying no `popoverKind`; it registered first, so it won the palette by
   * default and invoking it deleted the typed text and opened nothing. Removing
   * it then exposed that a declarative command had no `description`/`hint`
   * field at all, so the surviving row rendered its label three times.
   *
   * `curl` sees neither: no request is made, and nothing is logged.
   */
  it('[ac:ac-popover-create-edit-encji-wniesionej-prz] each slash command is offered once, with its own copy', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
    const { consoleErrors, badResponses } = watch(page);

    const res = await fetch(`${BASE}/api/projects/${project.id}/pages/pages`);
    const { tree } = (await res.json()) as { tree: Array<{ type: string; path: string }> };
    const first = tree.find((n) => n.type === 'file' && n.path.endsWith('.md'));
    if (!first) throw new Error('environment has no page with an editor — seed one first');

    await page.goto(`${BASE}/p/${project.id}/space/pages/${first.path}`, {
      waitUntil: 'networkidle',
    });
    const editor = page.locator('.ProseMirror').first();
    await expect.poll(() => editor.count()).toBe(1);

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/dto');

    // Scoped to the palette's own container. Its rows are plain buttons, and
    // the `/dto` just typed is in the document too, so a text-only search finds
    // the page's list items as readily as the menu's — it can report a
    // duplicate that isn't there, and miss one that is.
    const rows = page.locator('[data-slash-menu] button');
    await expect.poll(() => rows.count()).toBeGreaterThan(0);
    const dto = (await rows.allInnerTexts()).filter((t) => t.trim().startsWith('/dto'));

    expect(dto, 'palette rows offering /dto').toHaveLength(1);
    expect(dto[0], 'the row describes what the command does').toContain('Create a new DTO inline');

    // And invoking it opens exactly one popover, anchored near the caret rather
    // than at the fixed viewport position an unanchored shell falls back to.
    const caretY = await editor.evaluate(() => {
      const sel = window.getSelection();
      return sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect().bottom : null;
    });
    await page.keyboard.press('Enter');
    const dialog = page.locator('[role=dialog][aria-label="New DTO"]');
    await expect.poll(() => dialog.count()).toBe(1);

    if (caretY !== null) {
      const box = await dialog.boundingBox();
      expect(Math.abs(box!.y - caretY), 'popover distance from the caret').toBeLessThan(220);
    }

    await page.keyboard.press('Escape');
    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });

  it('[ac:ac-ddl-tabel-encji-zyje-w-module-backend-m] entity counts answer for every type, including deactivated ones', async () => {
    // Entity DDL moved into each module's own migrations, which run for every
    // AVAILABLE module rather than only the active ones — precisely so that a
    // type excluded by `config.entities` keeps an empty table. When it did not,
    // this endpoint threw `no such table` and 500'd the whole sidebar.
    const res = await fetch(`${BASE}/api/projects/${project.id}/entities/counts`);
    // Read the body ONCE — it is the error message on failure and the payload
    // on success, and a Response body cannot be consumed twice.
    const raw = await res.text();
    expect(res.status, raw).toBe(200);

    const counts = JSON.parse(raw) as Record<string, number>;
    // The two the envelope contributes.
    expect(Object.keys(counts)).toEqual(expect.arrayContaining(['endpoint', 'dto']));
    // Every value is a real number — a missing table cannot masquerade as absent.
    for (const [type, n] of Object.entries(counts)) {
      expect(Number.isInteger(n), `${type} -> ${n}`).toBe(true);
    }
  });
});
