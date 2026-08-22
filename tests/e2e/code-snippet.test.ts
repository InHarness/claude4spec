import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the `code-snippet` type's rendered surfaces (0.2.45).
 *
 * Out of Vitest's reach for the same three reasons the generic-embed suite
 * gives, plus one of its own:
 *
 *  - the card and chip are dispatched at RUNTIME off the client plugin host, so
 *    what is under test is a registration that exists only once the app booted;
 *  - the highlighter is a real bundle import and its output is a tree of
 *    `.hljs-*` spans — "did it colour" is a question about computed styles;
 *  - the chip's click must NOT navigate: the type has no detail route, so a
 *    `bridge.openEntity` would point at a URL that does not exist;
 *  - the palette comes from `--c-*` tokens and must survive a theme flip, which
 *    only a real stylesheet cascade can demonstrate.
 *
 * The console-error and failed-response assertions are the cheap half and the
 * likeliest to catch a regression: a card that renders can still be firing 404s
 * behind it.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
}

const PAGE_PATH = 'e2e-code-snippet.md';
const SLUG = 'e2e-manifest-shape';
const TITLE = 'E2E manifest shape';
const CAPTION_A = 'E2E CAPTION ALPHA';
const CAPTION_B = 'E2E CAPTION BETA';
/** Referenced on the page and never created — the broken-reference case. */
const MISSING_SLUG = 'no-such-code-snippet';
/** A second snippet, deleted before the assertions — the other broken case. */
const DOOMED_SLUG = 'e2e-doomed-snippet';

/** 40 lines, comfortably over the card's 30-line collapse threshold. */
const LONG_CODE = Array.from({ length: 40 }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n');

async function firstProject(): Promise<WorkspaceProject> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: WorkspaceProject[] };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project;
}

const api = (projectId: string, path: string) => `${BASE}/api/projects/${projectId}${path}`;

describe.skipIf(!BASE)('code-snippet — card, chip, overlay and broken state', () => {
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

    // `language: 'TS'` — the round trip must show the NORMALIZED value.
    await fetch(api(project.id, '/code-snippets'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: SLUG,
        title: TITLE,
        language: 'TS',
        filename: 'src/manifest.ts',
        code: LONG_CODE,
      }),
    });

    await fetch(api(project.id, '/code-snippets'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: DOOMED_SLUG, title: 'Doomed', code: 'const gone = true;' }),
    });

    /*
     * One page carrying every embedding path the type supports, plus the two it
     * does not. The same snippet appears TWICE with two different captions —
     * that pair is the whole of the caption criterion.
     */
    await fetch(api(project.id, `/pages/pages/${PAGE_PATH}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedHash: 'a'.repeat(64),
        body:
          `# Code snippet embeds\n\n` +
          `<single_element type="code-snippet" slug="${SLUG}" caption="${CAPTION_A}"/>\n\n` +
          `The same snippet again: <single_element type="code-snippet" slug="${SLUG}" caption="${CAPTION_B}"/>\n\n` +
          `Referenced inline: <inline_mention type="code-snippet" slug="${SLUG}"/>\n\n` +
          `A broken one: <inline_mention type="code-snippet" slug="${MISSING_SLUG}"/>\n\n` +
          `A deleted one: <single_element type="code-snippet" slug="${DOOMED_SLUG}"/>\n\n` +
          `And inline: <inline_mention type="code-snippet" slug="${DOOMED_SLUG}"/>\n`,
      }),
    });

    // Deleted AFTER the page references it: the reference outlives the entity,
    // which is the state the broken-reference path exists for.
    await fetch(api(project.id, `/code-snippets/${DOOMED_SLUG}`), { method: 'DELETE' });

    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    /*
     * Same-origin, MINUS the 404s this fixture deliberately provokes. Resolving
     * a broken reference IS a 404 on the entity — that is how the chip learns it
     * is broken — so naming the expected refusals is the honest alternative to
     * dropping either the zero-404 rule or the broken-reference case.
     */
    const ours = (url: string | undefined) =>
      Boolean(
        url &&
          url.startsWith(BASE!) &&
          !url.includes(MISSING_SLUG) &&
          !url.includes(DOOMED_SLUG),
      );
    page.on('console', (msg) => {
      if (msg.type() === 'error' && ours(msg.location()?.url)) consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on('response', (res) => {
      if (res.status() >= 400 && ours(res.url())) failedResponses.push(`${res.status()} ${res.url()}`);
    });
    /*
     * LAND ELSEWHERE FIRST, THEN NAVIGATE IN-APP — and this is a workaround for
     * a HOST bug, not a quirk of this type.
     *
     * `main.tsx` fires `bootFrontendPlugins()` without awaiting it before
     * `render()`. The router gates plugin ROUTES on `frontendPluginsBooted`
     * (`PendingOrNotFound` re-invalidates when boot settles), but nothing gates
     * the page editor's node views: a `<single_element type="<plugin type>"/>`
     * that renders before boot settles calls `getEntityDef()` against an empty
     * registry, draws the "unknown type" broken chip, and NEVER re-renders when
     * the plugin lands.
     *
     * It is not specific to `code-snippet`. Verified on `main`, where this type
     * does not exist at all: a page carrying
     * `<single_element type="spreadsheet" .../>` renders the same broken chip on
     * a cold load. Every envelope-contributed type is affected.
     *
     * So: one cold load on a page with no embeds, wait for boot, then a
     * client-side navigation to the fixture page — which is also the path a real
     * reader takes through the app. Filed as a patch against the spec.
     */
    await page.goto(`${BASE}/p/${project.id}/pages/index.md`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(6000);
    await page.getByText(PAGE_PATH, { exact: true }).first().click();
    await page.waitForTimeout(4000);
  });

  afterAll(async () => {
    if (project) {
      await fetch(api(project.id, `/pages/pages/${PAGE_PATH}`), { method: 'DELETE' }).catch(() => {});
      await fetch(api(project.id, `/code-snippets/${SLUG}`), { method: 'DELETE' }).catch(() => {});
    }
    await browser?.close();
  });

  it('[ac:ac-dwie-wspierane-sciezki-osadzenia-kart] renders a block card and an inline chip from the generic tags', async () => {
    await expect.poll(() => page.locator('[data-testid="code-snippet-card"]').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-testid="code-snippet-chip"]').count()).toBeGreaterThan(0);

    // The card header carries the filename in preference to the title, and the
    // language badge shows the NORMALIZED value — `TS` went in, `typescript` out.
    const card = page.locator(`[data-testid="code-snippet-card"][data-slug="${SLUG}"]`).first();
    expect(await card.innerText()).toContain('src/manifest.ts');
    // Case-insensitively: the badge is UPPERCASED by CSS (`text-transform`),
    // while the stored value is lower case. Asserting the rendered casing would
    // pin a style choice; asserting the letters pins the normalization.
    expect(
      (await card.locator('[data-testid="code-snippet-language-badge"]').innerText()).toLowerCase(),
    ).toBe('typescript');

    // The type registers no tag of its own, so nothing leaks as literal text.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('<code-snippet');
    expect(body).not.toContain('<single_element');

    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });

  it('[ac:ac-karta-snippetu-daje-podswietlanie-num] highlights, numbers the lines and offers a copy action, from palette tokens', async () => {
    const view = page.locator(`[data-slug="${SLUG}"] [data-testid="code-snippet-view"]`).first();
    await expect.poll(() => view.count()).toBeGreaterThan(0);

    // Highlighting: real token spans, not a plain <pre>. `typescript` is a
    // grammar the bundle registers, so this must NOT be the plaintext state.
    await expect.poll(() => view.locator('.hljs-keyword').count()).toBeGreaterThan(0);
    expect(await view.getAttribute('data-language')).toBe('typescript');

    // Line numbers, in a gutter that is not selectable — a copy must yield code,
    // not code with a column of integers welded onto every line.
    const gutter = view.locator('.c4s-code-snippet-gutter').first();
    expect(await gutter.innerText()).toContain('1');
    expect(await gutter.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');

    // Copy affordance.
    expect(
      await page.locator(`[data-slug="${SLUG}"] button[aria-label="Copy code"]`).count(),
    ).toBeGreaterThan(0);

    /*
     * The palette comes from `--c-*` tokens, never literals — so it must CHANGE
     * when the effective theme does. Asserting a specific hex would pin the
     * design system; asserting that light and dark differ pins the wiring, which
     * is the thing that breaks.
     */
    const bg = () => view.evaluate((el) => getComputedStyle(el).backgroundColor);
    const light = await bg();
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(300);
    const dark = await bg();
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    expect(dark).not.toBe(light);
    expect(light).not.toBe('rgba(0, 0, 0, 0)');
  });

  it('[ac:ac-snippet-ponad-prog-zwijania-renderuje] collapses a snippet over the threshold, and the overlay never does', async () => {
    const view = page.locator(`[data-slug="${SLUG}"] [data-testid="code-snippet-view"]`).first();
    // 40 lines against a 30-line threshold.
    await expect.poll(() => view.getAttribute('data-state')).toBe('collapsed');

    // The expand action names how much is hidden, rather than saying "more".
    const expand = page.locator(`[data-slug="${SLUG}"]`).first().getByRole('button', { name: /Show \d+ more lines/ });
    expect(await expand.count()).toBeGreaterThan(0);
    expect(await expand.first().innerText()).toContain('10');

    await expand.first().click();
    await expect.poll(() => view.getAttribute('data-state')).not.toBe('collapsed');
  });

  it('[ac:ac-caption-jest-atrybutem-referencji-nie] gives one snippet two captions, and writes neither to the entity', async () => {
    const captions = await page.locator('figcaption').allInnerTexts();
    // The SAME snippet, embedded twice, carrying two different captions.
    expect(captions.join('\n')).toContain(CAPTION_A);
    expect(captions.join('\n')).toContain(CAPTION_B);

    // Neither reached the entity — `caption` is not a field, so it appears in
    // neither the record nor its snapshot.
    const entity = (await (await fetch(api(project.id, `/code-snippets/${SLUG}`))).json()) as unknown;
    const json = JSON.stringify(entity);
    expect(json).not.toContain(CAPTION_A);
    expect(json).not.toContain(CAPTION_B);
    expect(json).not.toContain('caption');
  });

  it('opens the fullscreen overlay from the card without navigating, and closes it on Escape', async () => {
    const before = page.url();
    await page.locator(`[data-slug="${SLUG}"] button[aria-label="Open fullscreen"]`).first().click();
    await expect.poll(() => page.locator('[data-testid="code-snippet-fullscreen"]').count()).toBeGreaterThan(0);
    // A hidden type has no detail route: an overlay that renders while the
    // router has moved is still a bug.
    expect(page.url()).toBe(before);

    // The overlay ALWAYS shows everything — the collapse threshold is a property
    // of the card, and a surface whose job is "show me all of it" must not hide.
    const overlayView = page.locator('[data-testid="code-snippet-fullscreen"] [data-testid="code-snippet-view"]');
    await expect.poll(() => overlayView.getAttribute('data-state')).not.toBe('collapsed');
    expect(await overlayView.innerText()).toContain('const line40 = 40;');

    /*
     * The gutter and the code must share a baseline grid.
     *
     * They are SIBLING <pre> columns, so nothing structurally keeps line 40's
     * number beside line 40's text — only identical metrics do. The host imports
     * `highlight.js/styles/atom-one-dark.css` globally for the chat renderer, and
     * its base `.hljs` rule carries a font-size; when that leaked in, the two
     * columns drifted a little per line and were visibly out of step by the
     * bottom of a long snippet. A short fixture would not have caught it, which
     * is why this measures the LAST line rather than the first.
     */
    const metrics = await overlayView.evaluate((el) => {
      const gutter = el.querySelector('.c4s-code-snippet-gutter') as HTMLElement;
      const code = el.querySelector('code') as HTMLElement;
      const cs = (n: HTMLElement) => getComputedStyle(n);
      return {
        gutterLh: cs(gutter).lineHeight,
        codeLh: cs(code).lineHeight,
        gutterFs: cs(gutter).fontSize,
        codeFs: cs(code).fontSize,
        drift: Math.abs(gutter.getBoundingClientRect().height - code.getBoundingClientRect().height),
      };
    });
    expect(metrics.gutterLh).toBe(metrics.codeLh);
    expect(metrics.gutterFs).toBe(metrics.codeFs);
    // Same line count at the same metrics — the columns must end together.
    expect(metrics.drift).toBeLessThan(4);

    await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('[data-testid="code-snippet-fullscreen"]').count()).toBe(0);
    expect(page.url()).toBe(before);
  });

  it('[ac:ac-usuniecie-snippetu-daje-broken-card-i] shows a broken card and chip for a deleted snippet, leaving the page readable', async () => {
    const body = await page.locator('body').innerText();
    // The document still renders — a broken reference is a state, not a crash.
    expect(body).toContain('Code snippet embeds');
    // and the intact embeds beside it are unaffected
    expect(await page.locator(`[data-slug="${SLUG}"]`).count()).toBeGreaterThan(0);

    // Both broken references are visible AS broken and name the slug they
    // wanted — "broken" without the name gives a reader nothing to fix.
    expect(await page.locator(`[data-broken-ref="${DOOMED_SLUG}"]`).count()).toBeGreaterThan(0);
    expect(await page.locator(`[data-broken-ref="${MISSING_SLUG}"]`).count()).toBeGreaterThan(0);
    expect(body).toContain(MISSING_SLUG);
    expect(body).toContain(DOOMED_SLUG);
    // No unhandled failure reached the console (the entity 404s are excluded by
    // `ours`, since that 404 is HOW a chip discovers it is broken).
    expect(consoleErrors).toEqual([]);
  });

  it('[ac:ac-klik-na-broken-chipie-nie-otwiera-ful] a click on a broken chip opens nothing at all', async () => {
    const before = page.url();
    expect(await page.locator('[data-testid="code-snippet-fullscreen"]').count()).toBe(0);

    /*
     * Target the chip by its own marker, never by text. `getByText` also matches
     * every ANCESTOR containing the string, so `.first()` can resolve to a
     * wrapper whose centre lies over a perfectly good card — force-clicking that
     * opened the overlay and made this assertion fail for a reason that had
     * nothing to do with broken chips.
     */
    const broken = page.locator(`[data-testid="code-snippet-chip"][data-broken-ref="${MISSING_SLUG}"]`);
    expect(await broken.count()).toBeGreaterThan(0);
    await broken.first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);

    expect(await page.locator('[data-testid="code-snippet-fullscreen"]').count()).toBe(0);
    expect(page.url()).toBe(before);
    expect(consoleErrors).toEqual([]);
  });
});
