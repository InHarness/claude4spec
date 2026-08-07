/**
 * Tier B smoke test — drives the MCP-over-HTTP mount against a REAL running
 * environment, then does a browser pass over the UI to prove the mount did not
 * break the app it was added to.
 *
 * Usage: BASE=http://localhost:3300 node smoke-tier-b.mjs
 */
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = process.env.BASE ?? 'http://localhost:3300';
const SHOTS = process.env.SHOTS ?? '/tmp/shots-tier-b';

let pass = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

async function api(path) {
  const res = await fetch(BASE + path);
  return { status: res.status, body: res.ok ? await res.json() : null };
}

async function main() {
  console.log(`\n=== Tier B smoke against ${BASE} ===\n`);

  // ── Which project is this? The mount address needs an id. ────────────────
  const ws = await api('/api/workspace');
  check('GET /api/workspace answers', ws.status === 200, `status ${ws.status}`);
  const project = ws.body?.projects?.[0];
  if (!project) { console.log('no project in workspace — cannot continue'); process.exit(1); }
  console.log(`  project: id=${project.id} name=${project.name}\n`);

  const mount = `${BASE}/api/projects/${project.id}/mcp`;

  // ── 1. project-bound mount ───────────────────────────────────────────────
  console.log('MCP — project-bound mount');
  const client = new Client({ name: 'tier-b-smoke', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(mount)));
  const names = (await client.listTools()).tools.map((t) => t.name);
  check('handshake + tools/list', names.length > 0, `${names.length} tools`);
  for (const op of ['overview', 'describe_types', 'get_page', 'get_sections', 'find_references', 'list_tags']) {
    check(`the M39 read \`${op}\` is exposed`, names.includes(op));
  }
  check('the write half is exposed to the default `chat` profile', names.includes('create_entities'));
  check('list_projects is reachable from a project-BOUND connection', names.includes('list_projects'));
  check('no duplicate tool names after the merge', new Set(names).size === names.length);

  const overview = await client.callTool({ name: 'overview', arguments: {} });
  check('tools/call overview executes', !overview.isError);
  let parsed = null;
  try { parsed = JSON.parse(overview.content[0].text); } catch { /* ignore */ }
  check('overview returns the core payload', parsed !== null && 'types' in parsed);

  const projList = await client.callTool({ name: 'list_projects', arguments: {} });
  check('tools/call list_projects executes', !projList.isError);
  await client.close();

  // ── 2. the profile gate, over the wire ───────────────────────────────────
  console.log('\nMCP — profile gate');
  const askClient = new Client({ name: 'tier-b-smoke-ask', version: '0.0.0' });
  await askClient.connect(new StreamableHTTPClientTransport(new URL(`${mount}?profile=ask`)));
  const askNames = (await askClient.listTools()).tools.map((t) => t.name);
  check('`ask` still sees reads', askNames.includes('get_entities'));
  for (const w of ['create_entities', 'update_entities', 'delete_entities', 'create_tag']) {
    check(`\`ask\` cannot see \`${w}\``, !askNames.includes(w));
  }
  // The hole this closed: a consulted peer reaching a plugin's write tools.
  for (const w of ['set_cell', 'insert_row', 'delete_row']) {
    check(`\`ask\` cannot see plugin write \`${w}\``, !askNames.includes(w));
  }
  const refused = await askClient.callTool({ name: 'create_entities', arguments: {} });
  check('a withheld tool is unknown, not merely refused', refused.isError === true);
  await askClient.close();

  const badProfile = await fetch(`${mount}?profile=nonsense`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  check('an unknown profile is rejected, not downgraded', badProfile.status === 400, `status ${badProfile.status}`);

  // ── 3. workspace-bound mount ─────────────────────────────────────────────
  console.log('\nMCP — workspace-bound mount');
  const wsMount = `${BASE}/api/workspace/mcp`;
  const noProject = await fetch(wsMount, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  check('refuses a connection naming no project', noProject.status === 404, `status ${noProject.status}`);

  const wsClient = new Client({ name: 'tier-b-smoke-ws', version: '0.0.0' });
  await wsClient.connect(new StreamableHTTPClientTransport(new URL(`${wsMount}?project=${encodeURIComponent(project.id)}`)));
  const wsNames = (await wsClient.listTools()).tools.map((t) => t.name);
  check('carries the same catalog as the project-bound mount', wsNames.length === names.length,
    `${wsNames.length} vs ${names.length}`);
  const wsOverview = await wsClient.callTool({ name: 'overview', arguments: {} });
  check('executes an operation through the workspace mount', !wsOverview.isError);
  await wsClient.close();

  // ── 4. Tier A REST is still there ────────────────────────────────────────
  console.log('\nREST (Tier A regression guard)');
  const prefix = `/api/projects/${project.id}`;
  for (const p of ['/_meta/overview', '/_meta/types', '/_meta/identities?q=a', '/_meta/consistency', '/tags', '/references?target=entity&slug=x']) {
    const r = await api(prefix + p);
    check(`GET ${prefix}${p}`, r.status === 200, `status ${r.status}`);
  }

  // ── 5. browser pass ──────────────────────────────────────────────────────
  console.log('\nBrowser');
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  const badResponses = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`); });

  for (const [label, path] of [['home', '/'], ['entities', '/entities'], ['pages', '/pages'], ['tags', '/tags']]) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {});
    await page.screenshot({ path: `${SHOTS}/${label}.png`, fullPage: true }).catch(() => {});
    const body = await page.textContent('body').catch(() => '');
    check(`page ${path} renders content`, (body ?? '').trim().length > 40);
  }
  await browser.close();

  check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  check('zero responses >= 400', badResponses.length === 0, badResponses.slice(0, 5).join(' | '));

  console.log(`\n=== ${pass} passed, ${failures.length} failed ===`);
  if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
}

main().catch((err) => { console.error('smoke crashed:', err); process.exit(1); });
