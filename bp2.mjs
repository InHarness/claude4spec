/**
 * Browser pass for the CODE-REVIEW FIXES on top of Tier B.
 *
 * The first pass (bp.mjs) proves the pages render. This one targets the nine
 * findings that only a browser can see: the slash palette, the popover's
 * anchoring, the pane's layout, and the counts endpoint.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2];
const SHOTS = process.argv[3] ?? '/tmp/tierb-fix-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const consoleErrors = [];
const badResponses = [];
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`${page.url()} :: ${m.text()}`));
page.on('pageerror', (e) => consoleErrors.push(`${page.url()} :: [pageerror] ${e.message}`));
page.on('response', (r) => r.status() >= 400 && badResponses.push(`${r.status()} ${new URL(r.url()).pathname}`));

const ws = await (await page.request.get(`${BASE}/api/workspace`)).json();
const projectId = ws.projects[0].id;
const P = `/p/${projectId}`;

const go = async (path) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45_000 });
  await page.waitForTimeout(1800);
};

// ── 1. counts answers for every type, deactivated ones included ──
{
  const res = await page.request.get(`${BASE}/api/projects/${projectId}/entities/counts`);
  const body = res.ok() ? await res.json() : null;
  record(
    'entities/counts answers 200 for every type',
    res.ok() && body && Object.values(body).every(Number.isInteger),
    JSON.stringify(body),
  );
}

// ── 2. The slash palette: ONE /dto entry, and invoking it opens a popover ──
{
  const { tree } = await (await page.request.get(`${BASE}/api/projects/${projectId}/pages/pages`)).json();
  const first = (tree ?? []).find((n) => n.type === 'file' && n.path.endsWith('.md'));
  if (!first) {
    record('slash palette exercised', false, 'no page with an editor in this seed');
  } else {
    await go(`${P}/space/pages/${first.path}`);
    const editor = page.locator('.ProseMirror').first();
    if ((await editor.count()) === 0) {
      record('slash palette exercised', false, 'no ProseMirror editor on the page');
    } else {
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('/dto');
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${SHOTS}/slash-menu.png` });

      // The duplicate entry is the bug: two ROWS both labelled /dto. Count the
      // rows, not text nodes — a single row contains the label, the description
      // and the hint, and the typed "/dto" is in the document besides.
      const menu = page.locator('[data-slash-menu]').first();
      const rowTexts = await menu.locator('button').allInnerTexts();
      const dtoRows = rowTexts.filter((t) => t.trim().startsWith('/dto'));
      record('exactly one /dto entry in the palette', dtoRows.length === 1, JSON.stringify(dtoRows));

      // And it must describe itself: the host's hardcoded entry carried copy
      // that a declarative command had no field for until this change.
      record(
        'the entry carries its description and hint, not the label three times',
        dtoRows.length === 1 && /Create a new DTO inline/.test(dtoRows[0]),
        dtoRows[0]?.replace(/\n/g, ' | '),
      );

      // Caret anchoring: the popover must open near where we typed, not at the
      // fixed y=120 the unanchored shell used.
      const caret = await editor.evaluate((el) => {
        const s = window.getSelection();
        if (!s || s.rangeCount === 0) return null;
        const r = s.getRangeAt(0).getBoundingClientRect();
        return { y: r.bottom };
      });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${SHOTS}/slash-popover.png` });

      const dialog = page.locator('[role=dialog][aria-label="New DTO"]');
      const opened = (await dialog.count()) === 1;
      record('invoking /dto opens exactly one popover', opened, `${await dialog.count()} dialogs`);

      if (opened && caret) {
        const box = await dialog.boundingBox();
        const near = box && Math.abs(box.y - caret.y) < 220;
        record('the popover is anchored to the caret', Boolean(near), `popover y=${box?.y}, caret y=${Math.round(caret.y)}`);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
  }
}

// ── 3. The pane is a flex column: the breadcrumb stays pinned while the body scrolls ──
{
  const eps = await (await page.request.get(`${BASE}/api/projects/${projectId}/endpoints`)).json();
  const slug = (eps.endpoints ?? [])[0]?.slug;
  await go(`${P}/endpoints/${slug}`);
  const bar = page.locator('text=Details').first();
  const before = await bar.boundingBox();
  await page.mouse.move(700, 600);
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(700);
  const after = await bar.boundingBox();
  await page.screenshot({ path: `${SHOTS}/detail-scrolled.png`, fullPage: false });
  const pinned = before && after && Math.abs(before.y - after.y) < 4;
  record(
    'the breadcrumb bar stays pinned when the detail body scrolls',
    Boolean(pinned),
    `y ${Math.round(before?.y ?? -1)} → ${Math.round(after?.y ?? -1)}`,
  );
}

await browser.close();
console.log('\n─── console errors ───');
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)');
console.log('\n─── responses >= 400 ───');
console.log(badResponses.length ? [...new Set(badResponses)].join('\n') : '(none)');
console.log(`\nscreenshots: ${SHOTS}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length || consoleErrors.length || badResponses.length ? 1 : 0);
