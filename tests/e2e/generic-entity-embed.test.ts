import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: an entity is embedded through the GENERIC tags, and a hidden type opens
 * an overlay instead of navigating (0.2.15).
 *
 * Out of Vitest's reach for three separate reasons, which is why this is a
 * browser test rather than a unit one:
 *
 *  - the card is dispatched at RUNTIME off the client plugin host — `type=` in
 *    the markdown, `renderCard` in the registry — so the thing under test is a
 *    registration that only exists once the app has booted;
 *  - `diagram` renders through a LAZY mermaid import, so "does the card draw"
 *    is a question about a dynamic import resolving in a real bundle;
 *  - the chip's click must NOT navigate. Diagram has no detail route, so the
 *    old `bridge.openEntity` behaviour pointed at a URL that does not exist —
 *    a failure that looks like nothing at all in a unit test and like a blank
 *    page to a user.
 *
 * The console-error and failed-response assertions are the cheap half and the
 * ones most likely to catch a regression: a card that renders can still be
 * firing 404s behind it, which is exactly what a stale route would do.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
}

const PAGE_PATH = 'e2e-generic-embed.md';
const DIAGRAM_SLUG = 'e2e-embed-flow';
const CAPTION = 'E2E EMBED CAPTION';
/** Referenced on the page and never created — the broken-reference case. */
const MISSING_SLUG = 'no-such-diagram';

async function firstProject(): Promise<WorkspaceProject> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: WorkspaceProject[] };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project;
}

describe.skipIf(!BASE)('generic entity embed — a hidden type renders and opens an overlay', () => {
  let browser: Browser;
  let page: Page;
  let project: WorkspaceProject;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    await fetch(`${BASE}/api/projects/${project.id}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });

    await fetch(`${BASE}/api/projects/${project.id}/diagrams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: DIAGRAM_SLUG,
        format: 'mermaid',
        source: 'graph TD; Alpha-->Beta;',
      }),
    });

    // Both generic forms on one page: the block card and the inline chip. The
    // point of the release is that neither names the type in its TAG.
    await fetch(`${BASE}/api/projects/${project.id}/pages/pages/${PAGE_PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedHash: 'a'.repeat(64),
        body:
          `# Generic embed\n\n` +
          `<single_element type="diagram" slug="${DIAGRAM_SLUG}" caption="${CAPTION}"/>\n\n` +
          `Referenced inline: <inline_mention type="diagram" slug="${DIAGRAM_SLUG}"/>\n\n` +
          `And a broken one: <inline_mention type="diagram" slug="${MISSING_SLUG}"/>\n`,
      }),
    });

    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    /**
     * Both listeners are scoped to the app's OWN origin.
     *
     * A sandboxed env-runner container has no route to `fonts.gstatic.com`, so
     * the web-font request 404s there and nowhere else. Counting it reports an
     * environment's network policy as a defect in the app — and it does so
     * INTERMITTENTLY, since the font is cached after the first successful load,
     * which is the worst kind of red. The console message carries no URL of its
     * own, hence the `location()` read.
     */
    /**
     * Same-origin, MINUS the one 404 this fixture deliberately provokes.
     *
     * The page seeds `<inline_mention type="diagram" slug="no-such-diagram"/>`
     * on purpose, and resolving a broken reference is exactly a 404 on the
     * entity — that is HOW the chip learns it is broken. Counting it would make
     * the broken-reference case below un-assertable alongside a zero-404 rule,
     * and the honest fix is to name the expected refusal rather than to drop
     * either case.
     */
    const ours = (url: string | undefined) =>
      Boolean(url && url.startsWith(BASE!) && !url.includes(MISSING_SLUG));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && ours(msg.location()?.url)) consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on('response', (res) => {
      if (res.status() >= 400 && ours(res.url())) failedResponses.push(`${res.status()} ${res.url()}`);
    });
    await page.goto(`${BASE}/p/${project.id}/pages/${PAGE_PATH}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
  });

  afterAll(async () => {
    if (project) {
      await fetch(`${BASE}/api/projects/${project.id}/pages/pages/${PAGE_PATH}`, {
        method: 'DELETE',
      }).catch(() => {});
      await fetch(`${BASE}/api/projects/${project.id}/diagrams/${DIAGRAM_SLUG}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    await browser?.close();
  });

  it('renders the diagram as an SVG through the generic single_element card', async () => {
    // Not a placeholder, not a raw tag: the lazy mermaid import resolved and
    // drew. `<svg>` inside the card is the only proof of that which survives a
    // bundler change.
    await expect.poll(() => page.locator('.c4s-diagram-svg svg').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    // The old per-entity tag must not survive as literal text on the page.
    expect(await page.locator('body').innerText()).not.toContain('<diagram');
  });

  it('puts the reference caption in a figcaption, not on the entity', async () => {
    await expect.poll(() => page.locator('figcaption').first().innerText()).toContain(CAPTION);
    // The caption belongs to THIS reference — the entity never received it.
    const entity = (await (
      await fetch(`${BASE}/api/projects/${project.id}/diagrams/${DIAGRAM_SLUG}`)
    ).json()) as Record<string, unknown>;
    expect(JSON.stringify(entity)).not.toContain(CAPTION);
  });

  it('opens a fullscreen overlay from the card, and closes it on Escape, without navigating', async () => {
    /**
     * The behaviour the release exists for. `diagram` has no detail route, so
     * the pre-0.2.15 click handler navigated to a URL that does not exist. The
     * URL assertion is the real one here: an overlay that renders while the
     * router has moved is still a bug.
     */
    const before = page.url();
    await page.locator('figure button[aria-label*="Expand"]').first().click();
    await expect.poll(() => page.locator('[role="dialog"][aria-label*="Diagram"]').count()).toBeGreaterThan(0);
    expect(page.url()).toBe(before);

    /**
     * The overlay must FIT the diagram, which is a race rather than a layout
     * question: it is opened from an event carrying only `{ slug, caption }`
     * (so a chat chip can open it too) and renders the SVG afterwards, so a
     * fit that runs only on mount measures an empty stage and does nothing —
     * leaving the diagram at 100% in the corner of a full-screen surface, which
     * looks like the overlay is broken rather than unfitted.
     */
    await expect
      .poll(() => page.locator('[role="dialog"] svg').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => (await page.locator('[role="dialog"]').innerText()).includes('100%'))
      .toBe(false);

    await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('[role="dialog"][aria-label*="Diagram"]').count()).toBe(0);
    expect(page.url()).toBe(before);
  });

  it('renders a broken reference as a chip whose click does nothing', async () => {
    // "Renders but is inert" — the alternative failure is an overlay opening on
    // an entity that does not exist, which shows an empty shell and no reason.
    const body = await page.locator('body').innerText();
    expect(body).toContain(MISSING_SLUG);

    const before = page.url();
    const broken = page.locator(`text=${MISSING_SLUG}`).first();
    if ((await broken.count()) > 0) await broken.click({ force: true }).catch(() => {});
    await page.waitForTimeout(600);
    expect(page.url()).toBe(before);
    expect(await page.locator('[role="dialog"][aria-label*="Diagram"]').count()).toBe(0);
  });

  it('round-trips a caption-less single_element without inventing an empty caption', async () => {
    /**
     * The markdown → tiptap → markdown invariant. `serializeXmlTag` skips empty
     * values and the tiptap attribute defaults to `null` rather than `''`; if
     * either half regressed, every save of every page carrying a caption-less
     * embed would rewrite the tag with `caption=""` and produce a diff nobody
     * authored.
     */
    const path = 'e2e-caption-roundtrip.md';
    const url = `${BASE}/api/projects/${project.id}/pages/pages/${path}`;
    // The trailing paragraph is not decoration: it is where the caret is put
    // below. `single_element` is a SELECTABLE ATOM, so clicking the editor and
    // typing with the node selected replaces it — which is correct ProseMirror
    // behaviour and would look exactly like the embed being lost on save.
    const original =
      `# Round trip\n\n<single_element type="diagram" slug="${DIAGRAM_SLUG}"/>\n\nTail paragraph.\n`;
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: original, expectedHash: 'a'.repeat(64) }),
    });
    try {
      const editorPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await editorPage.goto(`${BASE}/p/${project.id}/pages/${path}`, { waitUntil: 'networkidle' });
      await editorPage.waitForTimeout(2000);
      // Click the TEXT, never the editor root — see the note on `original`.
      await editorPage.locator('.ProseMirror >> text=Tail paragraph.').first().click();
      await editorPage.keyboard.press('End');
      await editorPage.keyboard.type(' touched');
      await editorPage.waitForTimeout(3000);
      await editorPage.close();

      const saved = (await (await fetch(url)).json()) as { body: string };
      // The edit landed…
      expect(saved.body).toContain('Tail paragraph. touched');
      // …and the untouched embed came back byte-identical, with no caption.
      expect(saved.body).toContain(`<single_element type="diagram" slug="${DIAGRAM_SLUG}"/>`);
      expect(saved.body).not.toContain('caption=""');
    } finally {
      await fetch(url, { method: 'DELETE' }).catch(() => {});
    }
  });

  it('logged no console errors and no failed responses along the way', () => {
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
