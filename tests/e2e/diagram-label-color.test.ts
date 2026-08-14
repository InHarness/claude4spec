import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';

/**
 * E2E: the app's prose typography must not style mermaid's diagram labels.
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe to run
 * anywhere.
 *
 * Structurally out of Vitest's reach: this is a pure CASCADE question. Mermaid
 * emits real HTML inside the SVG's <foreignObject> —
 * `<div class="label"><span class="nodeLabel"><p>…</p></span></div>` — so
 * `.prose-spec p` matches that <p> DIRECTLY while the diagram's own theme reaches
 * it only by inheritance, and a direct match always wins. Only a browser resolves
 * that (specificity, source order, `@layer`); jsdom/happy-dom do not.
 *
 * Deliberately palette-INDEPENDENT. Since 0.1.141 the diagram carries its own
 * light/dark `themeVariables`, and its dark label ink is `--c-ink` by design — so
 * "the label is not --c-ink" is no longer a valid statement of the invariant. What
 * must hold in every theme is that the inner <p> does not DIVERGE from the label
 * container mermaid styles: the diagram's theme stays authoritative over its own
 * labels, whatever that theme currently says.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

/** Stand-in for whatever color mermaid's theme puts on the label container. */
const THEME_COLOR = 'rgb(1, 2, 3)';
const INK_LIGHT = 'rgb(42, 39, 34)'; // --c-ink #2a2722
const INK_DARK = 'rgb(236, 231, 220)'; // --c-ink #ece7dc

/**
 * Replicates mermaid's emitted label markup — including the enclosing <svg>, which
 * the containment selector requires — inside a `.prose-spec` root, and reads back
 * what the REAL stylesheet computes for it. The color on `.c4s-diagram-svg` plays
 * the part of mermaid's injected <style>, which the label can only inherit.
 */
const PROBE = (dark: boolean) => `(() => {
  document.documentElement.classList.toggle('dark', ${dark});
  document.getElementById('c4s-cascade-probe')?.remove();
  const host = document.createElement('div');
  host.id = 'c4s-cascade-probe';
  host.className = 'prose-spec';
  host.innerHTML =
    '<p id="probe-control">prose paragraph</p>' +
    '<div class="c4s-diagram-svg" style="color: ${THEME_COLOR}">' +
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject>' +
        '<div class="label"><span class="nodeLabel"><p id="probe-label">node label</p></span></div>' +
      '</foreignObject></svg>' +
    '</div>';
  document.body.appendChild(host);
  const read = (sel) => getComputedStyle(document.querySelector(sel)).color;
  return {
    label: read('#probe-label'),
    span: read('#c4s-cascade-probe .nodeLabel'),
    control: read('#probe-control'),
    labelMargin: getComputedStyle(document.querySelector('#probe-label')).marginBottom,
  };
})()`;

interface WorkspaceProject {
  id: string;
  name: string;
}

async function firstProject(): Promise<WorkspaceProject> {
  const res = await fetch(`${BASE}/api/workspace`);
  if (!res.ok) throw new Error(`GET /api/workspace → ${res.status}`);
  const body = (await res.json()) as { projects?: WorkspaceProject[] };
  const project = body.projects?.[0];
  if (!project) throw new Error('no project registered in this environment');
  await fetch(`${BASE}/api/projects/${project.id}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ onboardingCompleted: true }),
  });
  return project;
}

const PROBE_PAGE = 'e2e-diagram-label-color.md';
const PROBE_DIAGRAM = 'e2e-label-color-flow';

/**
 * A page that actually EMBEDS a diagram — the only kind that renders the card.
 *
 * 0.2.15: SEEDS one rather than hunting the corpus for a page that happens to
 * carry an embed. Two reasons, and the second is the one that bit:
 *
 *  - the tag changed. `<diagram/>` no longer exists; a diagram is embedded as
 *    `<single_element type="diagram" …/>`, so a scan for the old tag finds
 *    nothing in a corpus that has been migrated;
 *  - a scan finds nothing in an EMPTY environment either, which is the state an
 *    env-runner smoke environment starts in. A test that depends on somebody
 *    having seeded the right shape of page reports "seed one first" instead of
 *    an answer, and reads as a failure of the code under test.
 */
async function pageWithEmbeddedDiagram(projectId: string): Promise<string> {
  await fetch(`${BASE}/api/projects/${projectId}/diagrams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: PROBE_DIAGRAM,
      // `title` is required on every type since 0.2.22 — a create without one is
      // a 400, which surfaced here as an embed that never rendered.
      title: 'Label colour probe',
      format: 'mermaid',
      source: 'graph TD; Alpha-->Beta; Beta-->Gamma;',
    }),
  }).catch(() => {});
  await fetch(`${BASE}/api/projects/${projectId}/pages/pages/${PROBE_PAGE}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // The page may not exist; any hash passes the guard when there is nothing
      // to be stale against.
      expectedHash: 'a'.repeat(64),
      body: `# Label colour probe\n\n<single_element type="diagram" slug="${PROBE_DIAGRAM}" caption="Probe"/>\n`,
    }),
  });
  return PROBE_PAGE;
}

/**
 * For every mermaid label on the page: the computed style of the inner <p> mermaid
 * emits, next to the label container mermaid's own theme styles. Equal → the
 * diagram theme is authoritative. Different → app typography leaked in.
 *
 * `fontSize` and `lineHeight` carry this test, not `color`. Since 0.1.141 the
 * diagram palette mirrors the app tokens, so mermaid's label ink EQUALS `--c-ink`
 * in both themes — a color leak is currently invisible on a real diagram (verified:
 * deleting the containment rule from the live page's CSSOM leaves the color
 * unchanged and shifts font-size 16px→15.5px, line-height 24px→26.35px). Color is
 * still asserted so the day the two palettes diverge again, this catches it; the
 * synthetic probe above keeps a non-vacuous color check either way.
 */
const LABEL_VS_CONTAINER = `[...document.querySelectorAll('.nodeLabel, .edgeLabel')]
  .filter((el) => el.textContent.trim() && el.querySelector('p'))
  .map((el) => {
    const outer = getComputedStyle(el);
    const inner = getComputedStyle(el.querySelector('p'));
    const pick = (s) => ({ color: s.color, fontSize: s.fontSize, lineHeight: s.lineHeight });
    return {
      text: el.textContent.trim().slice(0, 24),
      container: pick(outer),
      inner: pick(inner),
      margin: inner.marginBottom,
    };
  })`;

interface LabelStyle {
  color: string;
  fontSize: string;
  lineHeight: string;
}

interface LabelProbe {
  text: string;
  container: LabelStyle;
  inner: LabelStyle;
  margin: string;
}

describe.skipIf(!BASE)('diagram labels keep mermaid’s styling, not the app’s prose typography', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function probe(dark: boolean) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const colors = (await page.evaluate(PROBE(dark))) as {
      label: string;
      span: string;
      control: string;
      labelMargin: string;
    };
    await page.close();
    return { ...colors, consoleErrors };
  }

  it('dark mode: the label inherits the diagram theme instead of the app’s ink', async () => {
    const { label, span, control, labelMargin, consoleErrors } = await probe(true);

    expect(label).toBe(THEME_COLOR);
    expect(span).toBe(THEME_COLOR);
    // the exact failure this guards: `--c-ink` bleeding into the diagram
    expect(label).not.toBe(INK_DARK);
    // `.prose-spec p`'s 14px bottom margin would distort the box mermaid measured
    expect(labelMargin).toBe('0px');
    // prose typography outside the diagram is untouched
    expect(control).toBe(INK_DARK);
    expect(consoleErrors).toEqual([]);
  });

  it('light mode: same containment, where the leak would otherwise be invisible', async () => {
    const { label, span, control, labelMargin, consoleErrors } = await probe(false);

    expect(label).toBe(THEME_COLOR);
    expect(span).toBe(THEME_COLOR);
    expect(labelMargin).toBe('0px');
    expect(control).toBe(INK_LIGHT);
    expect(consoleErrors).toEqual([]);
  });

  /**
   * The REAL diagram, both surfaces, both themes.
   *
   * The fullscreen overlay needs a `c4s-diagram-svg` hook of ITS OWN rather than
   * inheriting one, and 0.2.15 made that more true rather than less: the overlay
   * used to render inside the card's `<figure>`, i.e. under `.prose-spec`, and
   * now renders from `EntityOverlayHost` at the app root, outside it entirely.
   * Either way the hook is what makes mermaid's theme authoritative over its own
   * labels, and a build that drops it shows up here as a label diverging from
   * its container.
   */
  for (const theme of ['dark', 'light'] as const) {
    it(`${theme} mode: embedded diagram AND fullscreen overlay both follow mermaid’s theme`, async () => {
      const project = await firstProject();
      const pagePath = await pageWithEmbeddedDiagram(project.id);

      const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
      await ctx.addInitScript(
        (t) => localStorage.setItem('c4s:settings:theme', JSON.stringify({ v: 1, data: t })),
        theme,
      );
      const page = await ctx.newPage();
      const consoleErrors: string[] = [];
      const badResponses: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
      });
      page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
      page.on('response', (r) => {
        if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
      });

      await page.goto(`${BASE}/p/${project.id}/pages/${pagePath}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.c4s-diagram-svg svg');

      const embedded = (await page.evaluate(LABEL_VS_CONTAINER)) as LabelProbe[];
      expect(embedded.length).toBeGreaterThan(0);
      for (const l of embedded) {
        expect(l.inner, `embedded label "${l.text}" diverges from its container`).toEqual(
          l.container,
        );
        expect(l.margin).toBe('0px');
      }

      // top-right icon on the figure opens the fullscreen overlay, which re-injects
      // the same SVG — so the label count grows. Baseline BEFORE the click.
      const labelsBefore = await page.locator('.nodeLabel').count();
      await page.locator('figure button').first().click();
      await page.waitForFunction((n) => document.querySelectorAll('.nodeLabel').length > n, labelsBefore);

      const both = (await page.evaluate(LABEL_VS_CONTAINER)) as LabelProbe[];
      expect(both.length).toBeGreaterThan(embedded.length);
      for (const l of both) {
        expect(l.inner, `label "${l.text}" diverges from its container`).toEqual(l.container);
        expect(l.margin).toBe('0px');
      }

      expect(consoleErrors).toEqual([]);
      expect(badResponses).toEqual([]);
      await ctx.close();
    });
  }
});
