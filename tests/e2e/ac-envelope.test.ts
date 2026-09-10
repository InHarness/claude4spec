import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: `ac` still works now that it is delivered by the `c4s-plugin-ac` envelope
 * rather than registered by the core (0.2.80).
 *
 * Sibling of `frontend-mockups-envelope.test.ts`, written for the same reason:
 * the half of an extraction that has no server side at all. `/ac` changed
 * delivery mechanism completely — it used to be a `registerEditorExtension`
 * entry in the host dispatched by a hardcoded `case 'ac'` in `slashInvoke`, and
 * it is now a manifest `command` carrying a `popoverKind`, dispatched through
 * the generic `c4s:plugin-command` event to a popover the envelope mounts
 * itself.
 *
 * Nothing on the server changes when that breaks. No request is made, nothing is
 * logged, and `curl` reports a clean 200 for a page whose `/ac` opens nothing.
 * Two envelopes have shipped exactly that bug — a duplicate palette row that won
 * by mount order and carried no `popoverKind`.
 *
 * The `verifies` picker is here for the opposite reason: it is the one screen
 * that reads ACROSS types, so it fails if `clientPluginHost.listEntities()` did
 * not come with the move, and it fails silently — an empty picker looks like a
 * project with nothing to verify.
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

describe.skipIf(!BASE)('c4s-plugin-ac envelope', () => {
  let browser: Browser;
  let project: WorkspaceProject;

  /**
   * Everything these cases create, so `afterAll` can remove it.
   *
   * Setup without teardown is not a tidiness question here: this suite runs
   * against a long-lived environment shared with every other e2e file, several
   * of which assert on COUNTS ("N results"). A run that leaves four entities
   * behind changes what the next run sees, and the failure lands on whichever
   * suite happens to poll a number — never on this one.
   */
  const created: Array<{ collection: string; id: string }> = [];
  const track = (collection: string, id: string): string => {
    created.push({ collection, id });
    return id;
  };

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
  });
  afterAll(async () => {
    await browser?.close();
    const api = `${BASE}/api/projects/${project?.id}`;
    // Reverse order, and never let a failed delete fail the run: teardown that
    // reports someone else's problem is worse than teardown that is quiet.
    for (const { collection, id } of created.reverse()) {
      await fetch(`${api}/${collection}/${id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  });

  /**
   * The envelope loaded AT ALL, said by the host rather than inferred.
   *
   * This is the assertion that catches the failure mode with no other symptom: a
   * `hostApiVersion` the gate does not satisfy makes the loader `continue`
   * BEFORE `registerPlugin`, so the type is absent and the only evidence is one
   * log line nobody reads. Everything below would then fail in confusing ways;
   * this fails in an obvious one.
   */
  it('the envelope is loaded and contributes ac', async () => {
    const res = await fetch(`${BASE}/api/_meta/plugins`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      packages: Array<{ package: string; status: string; contributedTypes?: string[] }>;
    };

    const envelope = body.packages.find((p) => p.package === 'c4s-plugin-ac');
    expect(envelope, 'c4s-plugin-ac is not in /api/_meta/plugins').toBeDefined();
    expect(envelope!.status, 'envelope status').toBe('loaded');
    expect(envelope!.contributedTypes).toContain('ac');

    // And NOT from the core bootstrap any more — a type registered twice would
    // read as working while the envelope was in fact dead.
    const builtin = body.packages.find((p) => p.package === '@c4s/builtin');
    expect(builtin?.contributedTypes ?? []).not.toContain('ac');
  });

  it('the ac list renders from the envelope bundle', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    await page.goto(`${BASE}/p/${project.id}/acs`, { waitUntil: 'networkidle' });

    // The header's own result count — proof the query resolved, not merely that
    // a shell painted. Polled, because the envelope bundle boots after first
    // paint and the route does not exist until it does.
    await expect.poll(() => page.locator('body').innerText()).toMatch(/Acceptance Criteria/);
    await expect.poll(() => page.locator('body').innerText()).toMatch(/\d+\s+results?/i);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });

  /**
   * `/ac` offered exactly ONCE, opening ITS OWN popover.
   *
   * "Exactly once" is the regression: a `slashCommand` left on
   * `FrontendModule.editorExtensions` alongside the manifest contribution. The
   * palette filters by substring so both rows match, and the module-borne one
   * wins because frontend modules mount before plugin commands register —
   * selecting it deletes the typed text and opens nothing.
   *
   * The popover's `aria-label` proves the second half: that the `popoverKind`
   * dispatched reached the popover THIS envelope mounted.
   */
  it('/ac is offered once and opens its own popover', async () => {
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
    await page.keyboard.type('/ac');

    // Scoped to the palette's own container: its rows are plain buttons, and the
    // text just typed is in the document too, so a text-only search finds the
    // page's own content as readily as the menu's.
    const rows = page.locator('[data-slash-menu] button');
    await expect.poll(() => rows.count()).toBeGreaterThan(0);
    const matching = (await rows.allInnerTexts()).filter((t) => t.trim().startsWith('/ac'));

    expect(matching, 'palette rows offering /ac').toHaveLength(1);
    expect(matching[0], 'the row describes what the command does').toContain(
      'Create a new acceptance criterion inline',
    );

    const caretY = await editor.evaluate(() => {
      const sel = window.getSelection();
      return sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect().bottom : null;
    });
    await page.keyboard.press('Enter');
    const popover = page.locator('[role=dialog][aria-label="New acceptance criterion"]');
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

  /**
   * The polymorphic `verifies[]` picker, end to end.
   *
   * `verifies[].slug` declares `ref: '$type'`, so the picker offers one GROUP
   * per active type and feeds each from that type's own `listByTags`. It is the
   * only screen in the app that reads across every type at once, which makes it
   * the one that breaks if `clientPluginHost.listEntities()` had not been
   * published for the envelope to reach — and it breaks silently: an empty
   * picker is indistinguishable from a project with nothing to verify.
   */
  it('an ac detail offers a verifies group per active type', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    const api = `${BASE}/api/projects/${project.id}`;
    const slug = track('acs', `ac-e2e-envelope-${Date.now()}`);
    const created = await fetch(`${api}/acs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, title: 'The envelope delivers this criterion.' }),
    });
    expect(created.status, 'POST /acs').toBe(201);

    await page.goto(`${BASE}/p/${project.id}/acs/${slug}`, { waitUntil: 'networkidle' });

    // Rendered content, not just the URL: a white SPA shell also returns 200.
    await expect
      .poll(() => page.locator('body').innerText())
      .toMatch(/The envelope delivers this criterion\./);
    await expect.poll(() => page.locator('body').innerText()).toMatch(/Verifies/i);

    // The picker's groups are named for the ACTIVE types, and `diagram` is the
    // one type this branch does NOT move — so its presence proves the picker is
    // reading the registry rather than a list the envelope shipped with.
    await expect.poll(() => page.locator('body').innerText()).toMatch(/diagram/i);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });

  /**
   * The COLD-LOAD race, which is the regression this move surfaced.
   *
   * `bootFrontendPlugins` imports plugin frontends non-blocking, after first
   * paint. A page whose editor mounts first therefore renders its chips against
   * a registry that does not hold the envelope-delivered types yet — and a
   * ProseMirror NodeView renders ONCE, so nothing about a later
   * `registerFrontendModule` gave it a reason to run again. The reader was left
   * with "⚠ unknown type" permanently, on a type that registered 200ms later.
   *
   * Making `ac` the ninth envelope was enough to lose a race the other eight had
   * been winning: on the first build of this branch `ui-view` and `endpoint`
   * chips broke on the same page, which is what showed this was never about
   * `ac`. So this case deliberately asserts on a chip THIS BRANCH DOES NOT OWN
   * as well — the fix is a host one, and a test that only watched `ac` would go
   * green on a fix that only helped `ac`.
   *
   * A full `page.goto` is load-bearing: client-side navigation reuses an app
   * whose plugins are already imported, and passes even with the bug.
   */
  it('chips resolve on a cold load, for every envelope-delivered type', async () => {
    const api = `${BASE}/api/projects/${project.id}`;
    const stamp = Date.now();
    const acSlug = track('acs', `ac-cold-${stamp}`);
    const viewSlug = track('ui-views', `view-cold-${stamp}`);

    expect(
      (
        await fetch(`${api}/acs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: acSlug, title: 'A cold-load criterion.' }),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await fetch(`${api}/ui-views`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: viewSlug, title: 'ColdLoadView', url: '/cold', params: [] }),
        })
      ).status,
    ).toBe(201);

    const pagePath = `cold-load-chips-${stamp}.md`;
    const put = await fetch(`${api}/pages/pages/${pagePath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedHash: 'a'.repeat(64),
        body:
          `# Cold load chips\n\n` +
          `<inline_mention type="ac" slug="${acSlug}"/>\n\n` +
          `<inline_mention type="ui-view" slug="${viewSlug}"/>\n`,
      }),
    });
    expect(put.status).toBe(200);

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);
    try {
      await page.goto(`${BASE}/p/${project.id}/space/pages/${pagePath}`, {
        waitUntil: 'networkidle',
      });

      // Polled, not slept: the fix is a re-render on registration, so the chip
      // resolves as soon as the bundle lands rather than after a fixed delay.
      await expect
        .poll(() => page.locator('body').innerText(), { timeout: 15_000 })
        .toContain('A cold-load criterion');
      await expect
        .poll(() => page.locator('body').innerText(), { timeout: 15_000 })
        .toContain('ColdLoadView');

      const body = await page.locator('body').innerText();
      expect(body, 'ac chip resolved').not.toContain('unknown type: ac');
      expect(body, 'ui-view chip resolved').not.toContain('unknown type: ui-view');

      expect(consoleErrors, 'console errors').toEqual([]);
      expect(badResponses, 'responses >= 400').toEqual([]);
    } finally {
      await page.close();
      await fetch(`${api}/pages/pages/${pagePath}`, { method: 'DELETE' });
    }
  });

  /**
   * The version-history route, which the envelope now owns along with the other
   * two. It is the route most easily lost in a move: nothing links to it from
   * the list, so a fragment that forgot to mount it 404s only for someone who
   * clicked the History tab.
   */
  it('the history route mounts', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    const api = `${BASE}/api/projects/${project.id}`;
    const slug = track('acs', `ac-e2e-history-${Date.now()}`);
    const created = await fetch(`${api}/acs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, title: 'A criterion with a history.' }),
    });
    expect(created.status, 'POST /acs').toBe(201);

    await page.goto(`${BASE}/p/${project.id}/acs/${slug}/history`, { waitUntil: 'networkidle' });
    await expect.poll(() => page.locator('body').innerText()).toMatch(/version/i);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });
});
