import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the `module-dependency` type's rendered surfaces (0.2.70).
 *
 * This type is the repo's first HIDDEN-AND-LISTABLE one — no `routes` and no
 * `detailPanel`, yet a `renderRow` — and that combination is precisely what
 * Vitest cannot reach:
 *
 *  - the row is dispatched at RUNTIME off the client plugin host through
 *    `TaggedListView`, so what is under test is a registration that exists only
 *    once the app has booted and a `listByTags` call that crosses the network;
 *  - a listable type WITHOUT a detail route had no instance before this release,
 *    and the click path for it was wrong: the row navigated to
 *    `/module-dependencies/<slug>`, a route nothing registers. The unit test in
 *    `src/client/entities/openEntity.test.ts` pins the helper; only a browser
 *    can show that the row actually goes through it and that the reader stays on
 *    the page;
 *  - "the embed rendered rows rather than the host's NotListable placeholder" is
 *    a question about which component won a runtime dispatch.
 *
 * The console-error and failed-response assertions are the cheap half and the
 * likeliest to catch a regression: rows that render can still be firing 404s
 * behind them.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
}

const PAGE_PATH = 'e2e-module-dependency.md';
const TAG = 'm19';
/** The outgoing edge: M19 requires M13. Tagged `m19`, so the embed finds it. */
const SLUG_OUT = 'm19-requires-m13';
/**
 * The REVERSE edge, tagged `m13`. It must NOT appear in M19's embed — that is
 * the whole "one record, one direction" claim, and the reason incoming edges are
 * a `provider` filter rather than something an embed can reach.
 */
const SLUG_BACK = 'm13-requires-m19';
/** Referenced on the page and never created — the broken-reference case. */
const MISSING_SLUG = 'no-such-module-dependency';

const NEEDS_OUT = 'Bez tego nie ma czym zasilic widoku listy.';
const NEEDS_BACK = 'Stad bierze sie kolejnosc prezentacji.';

async function firstProject(): Promise<WorkspaceProject> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: WorkspaceProject[] };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project;
}

const api = (projectId: string, path: string) => `${BASE}/api/projects/${projectId}${path}`;

describe.skipIf(!BASE)('module-dependency — a hidden type that lists', () => {
  let browser: Browser;
  let page: Page;
  let project: WorkspaceProject;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    await fetch(api(project.id, '/config'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });

    /*
     * `title` is deliberately NOT sent on either edge: it is a reserved field
     * the author never fills, and the round trip must show the value
     * `computedDefault` derived from the two parties.
     */
    for (const [dependent, provider, needs, tag] of [
      ['M19', 'M13', NEEDS_OUT, TAG],
      ['M13', 'M19', NEEDS_BACK, 'm13'],
    ] as const) {
      await fetch(api(project.id, '/module-dependencies'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependent, provider, needs, tags: [tag] }),
      });
    }

    await fetch(api(project.id, `/pages/pages/${PAGE_PATH}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedHash: 'a'.repeat(64),
        body:
          `# Module dependency embeds\n\n` +
          `## Zaleznosci\n\n` +
          `<tagged_list type="module-dependency" tags="${TAG}"/>\n\n` +
          `As a card: <single_element type="module-dependency" slug="${SLUG_OUT}"/>\n\n` +
          `Inline: <inline_mention type="module-dependency" slug="${SLUG_OUT}"/>\n\n` +
          `A broken one: <inline_mention type="module-dependency" slug="${MISSING_SLUG}"/>\n`,
      }),
    });

    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // Same-origin, minus the 404 this fixture deliberately provokes: resolving a
    // broken reference IS a 404, which is how the chip learns it is broken.
    const ours = (url: string | undefined) =>
      Boolean(url && url.startsWith(BASE!) && !url.includes(MISSING_SLUG));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && ours(msg.location()?.url)) consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on('response', (res) => {
      if (res.status() >= 400 && ours(res.url())) failedResponses.push(`${res.status()} ${res.url()}`);
    });

    /*
     * Land elsewhere first, then navigate in-app — the same host bug the
     * `code-snippet` suite documents: `main.tsx` does not await
     * `bootFrontendPlugins()` before `render()`, so an embed of a
     * plugin-contributed type on a COLD load draws the unknown-type chip and
     * never re-renders. Affects every envelope type, not this one.
     */
    await page.goto(`${BASE}/p/${project.id}/pages/index.md`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(6000);
    await page.getByText(PAGE_PATH, { exact: true }).first().click();
    await page.waitForTimeout(4000);
  });

  afterAll(async () => {
    if (project) {
      await fetch(api(project.id, `/pages/pages/${PAGE_PATH}`), { method: 'DELETE' }).catch(() => {});
      for (const slug of [SLUG_OUT, SLUG_BACK]) {
        await fetch(api(project.id, `/module-dependencies/${slug}`), { method: 'DELETE' }).catch(() => {});
      }
    }
    await browser?.close();
  });

  /**
   * THE claim of the type. `renderRow` is what makes a hidden type listable, and
   * the visible failure of not declaring it is the host's `NotListable`
   * placeholder where the rows should be.
   */
  it('renders the tagged list as ROWS, not as the NotListable placeholder', async () => {
    const rows = page.locator('[data-testid="module-dependency-row"]');
    await expect.poll(() => rows.count()).toBeGreaterThan(0);

    const body = await page.locator('body').innerText();
    expect(body).not.toContain('not listable');
    expect(body).not.toContain('<tagged_list');

    // The row reads as a sentence: the two parties and the reason.
    const first = rows.first();
    const text = await first.innerText();
    expect(text).toContain('M19');
    expect(text).toContain('M13');
    expect(text).toContain('wymaga od');
    expect(text).toContain(NEEDS_OUT);

    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });

  /**
   * ONE DIRECTION PER RECORD. The reverse edge exists and is tagged `m13`, so
   * M19's section must not show it — incoming edges are a `provider` filter, not
   * something any embed reaches.
   */
  it('shows only OUTGOING edges — the reverse edge is tagged elsewhere', async () => {
    const listed = await page.locator('[data-testid="module-dependency-row"]').allInnerTexts();
    expect(listed.join('\n')).not.toContain(NEEDS_BACK);

    // And the reverse edge really does exist — otherwise this proves nothing.
    const res = await fetch(api(project.id, `/module-dependencies/${SLUG_BACK}`));
    expect(res.status).toBe(200);
  });

  /**
   * The slug is derived from the ordered pair and the title from
   * `computedDefault`; neither was sent on the create call.
   */
  it('derives the slug from the pair and the title from both parties', async () => {
    const res = await fetch(api(project.id, `/module-dependencies/${SLUG_OUT}`));
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { slug: string; title: string } };
    expect(data.slug).toBe(SLUG_OUT);
    expect(data.title).toBe('M19 wymaga od M13');
  });

  /**
   * THE REGRESSION THIS RELEASE INTRODUCED AND FIXED. A hidden type's row has no
   * detail route, so a click must raise the overlay and leave the reader on the
   * page. Before the fix it navigated to `/module-dependencies/<slug>` and the
   * reader was thrown to a not-found.
   */
  it('opens the overlay from a row click, without navigating away', async () => {
    const before = page.url();
    await page.locator('[data-testid="module-dependency-row"]').first().click();

    const overlay = page.locator('[data-testid="module-dependency-overlay"]');
    /*
     * Poll the CONTENT, not just the presence. The overlay always fetches on
     * open — the slot receives a slug and nothing else — so it mounts in its
     * loading state first, and asserting on `innerText` the moment it exists
     * reads an empty skeleton.
     */
    await expect.poll(() => overlay.innerText().catch(() => '')).toContain(NEEDS_OUT);
    // Still on the page that carried the embed — the whole point.
    expect(page.url()).toBe(before);

    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.click(5, 5);
  });

  /** The card and chip paths, and the broken state that has no entity behind it. */
  it('renders a card and an inline chip, and marks a broken reference', async () => {
    await expect.poll(() => page.locator('[data-testid="module-dependency-card"]').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-testid="module-dependency-chip"]').count()).toBeGreaterThan(0);

    const broken = page.locator(`[data-testid="module-dependency-chip"][data-broken-ref="${MISSING_SLUG}"]`);
    await expect.poll(() => broken.count()).toBe(1);
    expect(await broken.innerText()).toContain(MISSING_SLUG);

    /*
     * No chip may show the broken state for a slug that DOES resolve. This is
     * the loading-flash regression: `useGetBySlug` returning `null` while the
     * fetch is in flight skips the host's skeleton and paints "broken" first.
     */
    expect(await page.locator(`[data-broken-ref="${SLUG_OUT}"]`).count()).toBe(0);

    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
