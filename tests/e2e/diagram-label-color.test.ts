import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';

/**
 * E2E: the app's prose typography must not recolor mermaid's diagram labels.
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
 * The symptom is dark-mode-only: `--c-ink` is coincidentally dark in light mode
 * (#2a2722), so the leak is invisible there and near-white/unreadable in dark mode
 * against the diagram's light background. Both themes are asserted below.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

/** Stand-in for whatever color mermaid's theme puts on the label container. */
const THEME_COLOR = 'rgb(1, 2, 3)';
const INK_LIGHT = 'rgb(42, 39, 34)'; // --c-ink #2a2722
const INK_DARK = 'rgb(236, 231, 220)'; // --c-ink #ece7dc

/**
 * Replicates mermaid's emitted label markup inside a `.prose-spec` root and reads
 * back what the REAL stylesheet computes for it. The color on `.c4s-diagram-svg`
 * plays the part of mermaid's injected `<style>`, which the label can only inherit.
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
      '<div class="label"><span class="nodeLabel"><p id="probe-label">node label</p></span></div>' +
    '</div>';
  document.body.appendChild(host);
  const read = (id) => getComputedStyle(document.getElementById(id)).color;
  return { label: read('probe-label'), span: getComputedStyle(document.querySelector('#c4s-cascade-probe .nodeLabel')).color, control: read('probe-control') };
})()`;

describe.skipIf(!BASE)('diagram labels keep mermaid’s color, not the app’s prose ink', () => {
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
    };
    await page.close();
    return { ...colors, consoleErrors };
  }

  it('dark mode: the label inherits the diagram theme instead of turning near-white', async () => {
    const { label, span, control, consoleErrors } = await probe(true);

    expect(label).toBe(THEME_COLOR);
    expect(span).toBe(THEME_COLOR);
    // the exact failure this guards: `--c-ink` bleeding into the diagram
    expect(label).not.toBe(INK_DARK);
    // prose typography outside the diagram is untouched
    expect(control).toBe(INK_DARK);
    expect(consoleErrors).toEqual([]);
  });

  it('light mode: same containment, where the leak would otherwise be invisible', async () => {
    const { label, span, control, consoleErrors } = await probe(false);

    expect(label).toBe(THEME_COLOR);
    expect(span).toBe(THEME_COLOR);
    expect(control).toBe(INK_LIGHT);
    expect(consoleErrors).toEqual([]);
  });
});
