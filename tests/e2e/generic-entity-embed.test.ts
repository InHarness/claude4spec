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
          `And a broken one: <inline_mention type="diagram" slug="no-such-diagram"/>\n`,
      }),
    });

    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 400) failedResponses.push(`${res.status()} ${res.url()}`);
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

    await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('[role="dialog"][aria-label*="Diagram"]').count()).toBe(0);
    expect(page.url()).toBe(before);
  });

  it('renders a broken reference as a chip whose click does nothing', async () => {
    // "Renders but is inert" — the alternative failure is an overlay opening on
    // an entity that does not exist, which shows an empty shell and no reason.
    const body = await page.locator('body').innerText();
    expect(body).toContain('no-such-diagram');

    const before = page.url();
    const broken = page.locator('text=no-such-diagram').first();
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
    const original = `# Round trip\n\n<single_element type="diagram" slug="${DIAGRAM_SLUG}"/>\n`;
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: original, expectedHash: 'a'.repeat(64) }),
    });
    try {
      const editorPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await editorPage.goto(`${BASE}/p/${project.id}/pages/${path}`, { waitUntil: 'networkidle' });
      await editorPage.waitForTimeout(2000);
      const editor = editorPage.locator('.ProseMirror').first();
      await editor.click();
      await editorPage.keyboard.press('End');
      await editorPage.keyboard.type(' touched');
      await editorPage.waitForTimeout(3000);
      await editorPage.close();

      const saved = (await (await fetch(url)).json()) as { body: string };
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
