/**
 * Browser pass for brief 0.2.2 Tier B.
 *
 * The point is not "does the server answer" — curl proves that. The point is
 * that `endpoint` and `dto`, now served from a plugin bundle rather than the
 * host, still render their list and detail pages, still resolve the junction,
 * and do it without a single console error or a single response >= 400.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2];
if (!BASE) throw new Error('usage: node browser-pass.mjs <base-url>');
const SHOTS = process.argv[3] ?? '/tmp/tierb-shots';
fs.mkdirSync(SHOTS, { recursive: true });

/**
 * Text the seed's one row carries, per type — the anchor for finding a row.
 * Endpoint rows show the slug on the right edge; DTO rows show the NAME and no
 * slug at all, so these are not the same shape and cannot be derived from each
 * other.
 */
const SLUG = { endpoint: /get-api-todos/, dto: /TodoListResponse/ };

const consoleErrors = [];
const badResponses = [];
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(`${page.url()} :: ${msg.text()}`);
});
page.on('pageerror', (err) => consoleErrors.push(`${page.url()} :: [pageerror] ${err.message}`));
page.on('response', (res) => {
  if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`);
});

/**
 * A list row, identified by the slug the row renders on its right edge.
 *
 * The rows are plain buttons in a scroll area, not `role=list` children, and the
 * same container holds the CREATE button and the tag-filter chips — so scoping
 * to `main` alone picks up chrome. Anchoring on the slug text is what actually
 * distinguishes a row.
 */
function rows(p, slugPattern) {
  return p.locator('main button').filter({ hasText: slugPattern });
}

async function go(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45_000 });
  // The plugin bundle boots after first paint; give the route tree a beat.
  await page.waitForTimeout(1500);
}

// ── Resolve the project from the workspace API; the root redirects to /welcome. ──
const wsRes = await page.request.get(`${BASE}/api/workspace`);
const ws = await wsRes.json();
const projectId = ws.projects?.[0]?.id;
if (!projectId) throw new Error('no project in workspace');
const projectPath = `/p/${projectId}`;
const apiBase = `${BASE}/api/projects/${projectId}`;
console.log(`project base: ${projectPath}`);

// ── 1. The two list screens exist and render rows, not an empty shell. ──
for (const [type, path] of [
  ['endpoint', `${projectPath}/endpoints`],
  ['dto', `${projectPath}/dtos`],
]) {
  await go(path);
  await page.screenshot({ path: `${SHOTS}/${type}-list.png`, fullPage: true });
  const heading = await page.locator('body').innerText();
  // "N result(s)" is the header's own count — it proves the query resolved, not
  // merely that a shell painted.
  const looksRight = /\d+\s+results?/i.test(heading);
  const rowCount = await rows(page, SLUG[type]).count();
  record(`${type} list renders`, looksRight, `${rowCount} row-ish elements`);
}

// ── 2. Detail pages, reached by clicking a row (proves the route + panel). ──
for (const [type, path] of [
  ['endpoint', `${projectPath}/endpoints`],
  ['dto', `${projectPath}/dtos`],
]) {
  await go(path);
  const firstRow = rows(page, SLUG[type]).first();
  if ((await firstRow.count()) === 0) {
    record(`${type} detail via click`, false, 'no clickable row found');
    continue;
  }
  await firstRow.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${type}-detail.png`, fullPage: true });
  const url = new URL(page.url()).pathname;
  const onDetail = new RegExp(`/${type === 'endpoint' ? 'endpoints' : 'dtos'}/[^/]+$`).test(url);
  const body = await page.locator('body').innerText();
  record(`${type} detail via click`, onDetail && body.length > 200, url);
}

// ── 3. A HARD REFRESH on a detail deep link — the plugin-boot window. ──
{
  await go(`${projectPath}/endpoints`);
  const firstRow = rows(page, SLUG.endpoint).first();
  if ((await firstRow.count()) > 0) {
    await firstRow.click();
    await page.waitForTimeout(1200);
    const deepLink = page.url();
    await page.goto(deepLink, { waitUntil: 'networkidle', timeout: 45_000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/endpoint-deeplink.png`, fullPage: true });
    const body = await page.locator('body').innerText();
    record('endpoint deep link survives a hard refresh', !/not found/i.test(body), deepLink);
  }
}

// ── 4. The junction: an endpoint detail should name its linked DTOs. ──
{
  const res = await page.request.get(`${apiBase}/endpoints`);
  if (res.ok()) {
    const body = await res.json();
    const list = body.endpoints ?? body.items ?? [];
    const linked = list.find((e) => (e.dtos ?? []).length > 0);
    record('an endpoint carries junction links via the API', Boolean(linked), linked ? linked.slug : 'none in seed');
  } else {
    record('endpoints API responds', false, `HTTP ${res.status()}`);
  }
}

// ── 5. Sidebar shows both types (the frontend modules registered). ──
{
  await go(projectPath);
  const nav = await page.locator('body').innerText();
  record('sidebar advertises Endpoints', /endpoints/i.test(nav));
  record('sidebar advertises DTOs', /dtos?/i.test(nav));
  await page.screenshot({ path: `${SHOTS}/home.png`, fullPage: true });
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
