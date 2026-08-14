import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: `ui-view` and `design-system` still work now that they are delivered by
 * the `c4s-plugin-frontend-mockups` envelope rather than registered by the core
 * (0.2.18).
 *
 * `tests/e2e/hoisted-entity-routes.test.ts` already covers that both list and
 * detail pages render; what it cannot see is the half of the move that has no
 * server side at all. Both slash commands changed delivery mechanism
 * completely: they used to be `registerEditorExtension` entries in the host
 * dispatched by a hardcoded `case` in `slashInvoke`, and they are now manifest
 * `commands` carrying a `popoverKind`, dispatched through the generic
 * `c4s:plugin-command` event to a popover the envelope mounts itself.
 *
 * Nothing on the server changes when that breaks. No request is made, nothing
 * is logged, and `curl` reports a clean 200 for a page whose `/uiview` opens
 * nothing. The api-contracts envelope shipped exactly that bug twice — a
 * duplicate palette row that won by mount order and carried no `popoverKind` —
 * which is why this file exists rather than a unit test on the manifest.
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

describe.skipIf(!BASE)('c4s-plugin-frontend-mockups envelope', () => {
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
    { type: 'ui-view', path: 'ui-views', heading: /UI Views/ },
    { type: 'design-system', path: 'design-systems', heading: /Design Systems/ },
  ] as const;

  for (const { type, path, heading } of TYPES) {
    it(`[ac:ac-pilotowa-koperta-wbudowana-c4s-plugin-a] ${type} list renders from the envelope bundle`, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { consoleErrors, badResponses } = watch(page);

      await page.goto(`${BASE}/p/${project.id}/${path}`, { waitUntil: 'networkidle' });

      // The header's own result count — proof the query resolved, not merely
      // that a shell painted. Polled, because the envelope bundle boots after
      // first paint and the route does not exist until it does.
      await expect.poll(() => page.locator('body').innerText()).toMatch(heading);
      await expect.poll(() => page.locator('body').innerText()).toMatch(/\d+\s+results?/i);

      expect(consoleErrors, 'console errors').toEqual([]);
      expect(badResponses, 'responses >= 400').toEqual([]);
      await page.close();
    });
  }

  /**
   * The two commands, each offered exactly once and each opening ITS OWN
   * popover.
   *
   * "Exactly once" is the regression the api-contracts envelope hit twice: a
   * `slashCommand` left on `FrontendModule.editorExtensions` alongside the
   * manifest contribution. The palette filters by substring so both rows match,
   * and the module-borne one wins because frontend modules mount before plugin
   * commands register — selecting it deletes the typed text and opens nothing.
   *
   * The popover's `aria-label` is what proves the SECOND half: that the
   * `popoverKind` dispatched reached the popover this envelope mounted, and not
   * some other kind's.
   */
  const COMMANDS = [
    { trigger: '/uiview', description: 'Create a new UI view inline', dialog: 'New UI view' },
    {
      trigger: '/design-system',
      description: 'Create a new design system inline',
      dialog: 'New design system',
    },
  ] as const;

  for (const { trigger, description, dialog } of COMMANDS) {
    it(`[ac:ac-popover-create-edit-encji-wniesionej-prz] ${trigger} is offered once and opens its own popover`, async () => {
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
      await page.keyboard.type(trigger);

      // Scoped to the palette's own container. Its rows are plain buttons, and
      // the text just typed is in the document too, so a text-only search finds
      // the page's own content as readily as the menu's — it can report a
      // duplicate that isn't there, and miss one that is.
      const rows = page.locator('[data-slash-menu] button');
      await expect.poll(() => rows.count()).toBeGreaterThan(0);
      const matching = (await rows.allInnerTexts()).filter((t) => t.trim().startsWith(trigger));

      expect(matching, `palette rows offering ${trigger}`).toHaveLength(1);
      expect(matching[0], 'the row describes what the command does').toContain(description);

      // Invoking it opens exactly one popover, anchored near the caret rather
      // than at the fixed viewport position an unanchored shell falls back to.
      const caretY = await editor.evaluate(() => {
        const sel = window.getSelection();
        return sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect().bottom : null;
      });
      await page.keyboard.press('Enter');
      const popover = page.locator(`[role=dialog][aria-label="${dialog}"]`);
      await expect.poll(() => popover.count()).toBe(1);

      if (caretY !== null) {
        const box = await popover.boundingBox();
        expect(Math.abs(box!.y - caretY), 'popover distance from the caret').toBeLessThan(220);
      }

      await page.keyboard.press('Escape');
      expect(consoleErrors, 'console errors').toEqual([]);
      expect(badResponses, 'responses >= 400').toEqual([]);
      await page.close();
    });
  }

  /**
   * The ref that puts both types in one envelope, end to end through the UI.
   *
   * `ui-view.designSystemSlug` declares `ref: 'design-system'`. A detail page
   * that cannot resolve the picker's options is the visible symptom of the two
   * types having been split across envelopes, or of the design-system hooks not
   * having travelled with them — and it is invisible to the server.
   */
  it('[ac:ac-pilotowa-koperta-wbudowana-c4s-plugin-a] a ui-view detail offers its design-system relation', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    const slug = `e2e-envelope-view-${Date.now()}`;
    const dsSlug = `e2e-envelope-ds-${Date.now()}`;
    const api = `${BASE}/api/projects/${project.id}`;

    const dsRes = await fetch(`${api}/design-systems`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `title`, not `name`: 0.2.22 made `title` the reserved display field on
      // every type, and this write had kept spelling it the old way — a 400 the
      // suite has been failing on since, unrelated to the junction under test.
      body: JSON.stringify({ slug: dsSlug, title: 'E2E Envelope DS', groups: [], modes: [] }),
    });
    expect(dsRes.status, 'POST /design-systems').toBe(201);

    const viewRes = await fetch(`${api}/ui-views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        title: 'E2E Envelope View',
        url: '/e2e',
        params: [],
        designSystemSlug: dsSlug,
      }),
    });
    expect(viewRes.status, 'POST /ui-views').toBe(201);

    // The ref, in the payload: `designSystemSlug` is what `ui-view` DECLARES,
    // and 0.2.23 makes the record a function of that declaration alone — so its
    // presence here is the proof the ref survived, not a view's courtesy.
    const readBack = await fetch(`${api}/ui-views/${slug}`).then((r) => r.json() as Promise<{ data: { designSystemSlug: string } }>);
    expect(readBack.data.designSystemSlug, 'ui-view record carries its ref').toBe(dsSlug);

    await page.goto(`${BASE}/p/${project.id}/ui-views/${slug}`, { waitUntil: 'networkidle' });

    // And in the panel: the title proves the detail query resolved, and the
    // design system's own TITLE proves the picker resolved the ref to a real
    // entity. It shows the title rather than the slug — the slug is the join
    // key, not the label — so asserting on the slug here would only pin how the
    // picker happens to spell a name.
    await expect.poll(() => page.locator('body').innerText()).toContain('E2E Envelope View');
    await expect.poll(() => page.locator('body').innerText()).toContain('E2E Envelope DS');

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });
});
