#!/usr/bin/env node
/**
 * 2.1.60 — the two measurements the specification asks for openly
 * (pages/SKILL.md, open questions #66 and #67; M31 `m31ctx001`, M40, M41).
 *
 *   1. FD budget (#66): every project of a workspace built live AT ONCE through
 *      the real background build queue of the real server — open descriptors
 *      against the process limit, the directory watches in use (and, on Linux,
 *      the inotify watches against `max_user_watches`).
 *   2. Flat line (#67): K rebuild cycles (invalidation → rebuild) of one project,
 *      with an open, IDLE MCP session on that project, heap (after `gc()`) and
 *      descriptors per cycle — flat = no growth beyond a small tolerance.
 *
 * Runs against the BUILT server (`dist/`), in-process, so descriptors and heap
 * are the server's own:
 *
 *   npm run build:envelopes && npm run build:server
 *   node --expose-gc scripts/measure-context-lifecycle.mjs [--projects=30] [--dirs=60] \
 *     [--files=4] [--cycles=20] [--warmup=3] [--headroom=0.2] [--fd-tolerance=3] \
 *     [--heap-tolerance-mb=4] [--keep]
 *
 * Prints ONE JSON object on stdout (the server's own logging goes to stderr).
 * Exit code: 0 both measurements pass, 1 a measurement fails its criterion,
 * 2 the harness itself failed (no `gc`, server did not start, builds stalled).
 * A failed measurement 1 is NOT a code change: the specification goes back to a
 * bounded number of live contexts (M31) — record it as a deviation.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ── stdout is the result channel: everything the server logs goes to stderr ──
const toStderr = (...args) => process.stderr.write(`${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = (rel) => pathToFileURL(path.join(repoRoot, 'dist', rel)).href;

// ── options ──────────────────────────────────────────────────────────────────
function option(name, fallback) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (!hit.includes('=')) return true;
  const raw = hit.slice(hit.indexOf('=') + 1);
  return typeof fallback === 'number' ? Number(raw) : raw;
}
const opts = {
  projects: option('projects', 30),
  dirsPerProject: option('dirs', 60),
  filesPerDir: option('files', 4),
  cycles: option('cycles', 20),
  warmup: option('warmup', 3),
  /** Share of the limit kept free for sockets, agent turns, the db's own files. */
  headroom: option('headroom', 0.2),
  fdTolerance: option('fd-tolerance', 3),
  heapToleranceMb: option('heap-tolerance-mb', 4),
  /** Builds may take long; this clock is re-armed by every project that turns live. */
  stallMs: option('stall-ms', 180_000),
  keep: option('keep', false) === true,
};

// ── probes ───────────────────────────────────────────────────────────────────
function openFds() {
  for (const dir of ['/proc/self/fd', '/dev/fd']) {
    try {
      // readdir itself holds one descriptor while listing.
      return fs.readdirSync(dir).length - 1;
    } catch {
      /* next */
    }
  }
  try {
    const out = execFileSync('lsof', ['-p', String(process.pid)], { encoding: 'utf-8' });
    return out.trim().split('\n').length - 1;
  } catch {
    return null;
  }
}

function fdLimit() {
  try {
    const line = fs
      .readFileSync('/proc/self/limits', 'utf-8')
      .split('\n')
      .find((l) => l.startsWith('Max open files'));
    if (line) {
      const [soft, hard] = line.replace('Max open files', '').trim().split(/\s+/);
      return { soft: Number(soft), hard: hard === 'unlimited' ? null : Number(hard), source: '/proc/self/limits' };
    }
  } catch {
    /* not Linux */
  }
  // A child shell inherits this process's limits.
  const read = (flag) => execFileSync('sh', ['-c', `ulimit ${flag}`], { encoding: 'utf-8' }).trim();
  const soft = read('-Sn');
  const hard = read('-Hn');
  return { soft: Number(soft), hard: hard === 'unlimited' ? null : Number(hard), source: 'ulimit' };
}

/** Linux only: inotify watches held by this process, and the per-user limits. */
function inotify() {
  if (!fs.existsSync('/proc/self/fdinfo')) return null;
  let instances = 0;
  let watches = 0;
  for (const fd of fs.readdirSync('/proc/self/fd')) {
    let target;
    try {
      target = fs.readlinkSync(`/proc/self/fd/${fd}`);
    } catch {
      continue;
    }
    if (!target.includes('inotify')) continue;
    instances++;
    try {
      watches += fs
        .readFileSync(`/proc/self/fdinfo/${fd}`, 'utf-8')
        .split('\n')
        .filter((l) => l.startsWith('inotify wd:')).length;
    } catch {
      /* closed meanwhile */
    }
  }
  const readNum = (p) => {
    try {
      return Number(fs.readFileSync(p, 'utf-8').trim());
    } catch {
      return null;
    }
  };
  return {
    instances,
    watches,
    maxUserWatches: readNum('/proc/sys/fs/inotify/max_user_watches'),
    maxUserInstances: readNum('/proc/sys/fs/inotify/max_user_instances'),
  };
}

/** `fs.watch` handles alive in this process (libuv `FSEventWrap`). */
function watchHandles() {
  return process.getActiveResourcesInfo().filter((r) => r === 'FSEventWrap').length;
}

function heap() {
  const m = process.memoryUsage();
  return { heapUsed: m.heapUsed, external: m.external, arrayBuffers: m.arrayBuffers, rss: m.rss };
}

function countDirs(root) {
  let n = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      n++;
      walk(path.join(dir, e.name));
    }
  };
  walk(root);
  return n;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function collect() {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setImmediate(r));
    global.gc();
  }
}

/**
 * Sample until descriptors and watch handles are stable for three samples in a
 * row — the released context's dispose is asynchronous. Re-armed by every
 * change; gives up after 100 samples without three equal ones.
 */
async function settle() {
  let last = null;
  let same = 0;
  for (let i = 0; i < 100 && same < 3; i++) {
    await sleep(100);
    await collect();
    const now = `${openFds()}:${watchHandles()}`;
    same = now === last ? same + 1 : 0;
    last = now;
  }
}

/** Least-squares slope of `ys` per step. */
function slope(ys) {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  });
  return num / den;
}

// ── workspace ────────────────────────────────────────────────────────────────
function writeProjectTree(cwd, index) {
  const pages = path.join(cwd, 'pages');
  for (let d = 0; d < opts.dirsPerProject; d++) {
    // Two levels — areas and topics under them — as a real pages root nests.
    const dir = path.join(pages, `area-${d % 8}`, `topic-${d}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let f = 0; f < opts.filesPerDir; f++) {
      fs.writeFileSync(
        path.join(dir, `page-${f}.md`),
        `# Project ${index} — topic ${d}, page ${f}\n\n## Purpose\n\nMeasurement fixture.\n\n## Details\n\n${'Lorem ipsum dolor sit amet. '.repeat(20)}\n`,
      );
    }
  }
}

async function main() {
  if (typeof global.gc !== 'function') {
    return { exit: 2, result: { ok: false, error: 'run node with --expose-gc' } };
  }

  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-measure-')));
  process.env.C4S_HOME = path.join(tmp, 'registry');

  const { WorkspaceRegistry } = await import(dist('server/workspace/registry.js'));
  const { bootstrapProject } = await import(dist('server/workspace/bootstrap.js'));
  const { startServer } = await import(dist('server/index.js'));
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

  const registry = new WorkspaceRegistry(process.env.C4S_HOME);
  const created = registry.selectOrCreate({ name: 'default', userHome: tmp });
  const projects = [];
  for (let i = 0; i < opts.projects; i++) {
    const cwd = path.join(tmp, 'projects', `p${String(i).padStart(3, '0')}`);
    fs.mkdirSync(cwd, { recursive: true });
    // Activated (config written) before the start, so the background build
    // brings each project to `ready` — a live context — not «needs activation».
    const { project } = bootstrapProject(registry, created, cwd);
    writeProjectTree(cwd, i);
    projects.push(project);
  }
  const dirsTotal = projects.reduce((n, p) => n + countDirs(p.cwd), 0);

  await collect();
  const before = { fds: openFds(), watchHandles: watchHandles(), heap: heap() };

  const workspace = registry.openView('default');
  const startedAt = Date.now();
  const server = await startServer({ cwd: tmp, registry, workspace, port: 0, host: '127.0.0.1', mode: 'prod' });
  const base = `http://127.0.0.1:${server.port}`;
  const api = async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${await res.text()}`);
    return res.json();
  };

  const result = { ok: false, options: opts, platform: { os: process.platform, node: process.version } };
  let mcp = null;
  try {
    // ── measurement 1 — every context live at once ──────────────────────────
    let live = 0;
    let lastProgress = Date.now();
    for (;;) {
      const ws = await api('GET', '/api/workspace');
      const nowLive = ws.projects.filter((p) => p.live).length;
      if (nowLive > live) {
        live = nowLive;
        lastProgress = Date.now();
      }
      if (live === projects.length) break;
      if (Date.now() - lastProgress > opts.stallMs) {
        throw new Error(`background builds stalled at ${live}/${projects.length} live projects`);
      }
      await sleep(200);
    }
    const allLiveMs = Date.now() - startedAt;
    await settle();
    const limit = fdLimit();
    const fds = openFds();
    const watches = watchHandles();
    const ino = inotify();
    const budget = Math.floor(limit.soft * (1 - opts.headroom));
    const perProjectFds = (fds - before.fds) / projects.length;
    const fdFits = fds <= budget;
    const inotifyFits = !ino || ino.maxUserWatches == null || ino.watches <= ino.maxUserWatches * (1 - opts.headroom);
    result.fdBudget = {
      projects: projects.length,
      dirsTotal,
      allLiveMs,
      fdsBefore: before.fds,
      fdsAllLive: fds,
      fdLimit: limit,
      fdBudget: budget,
      perProjectFds: Number(perProjectFds.toFixed(2)),
      projectsFittingBudget: perProjectFds > 0 ? Math.floor((budget - before.fds) / perProjectFds) : null,
      watchHandles: { before: before.watchHandles, allLive: watches, perProject: Number(((watches - before.watchHandles) / projects.length).toFixed(2)) },
      inotify: ino,
      heapAllLive: heap(),
      pass: fdFits && inotifyFits,
      criterion: `open FDs ≤ ${Math.round((1 - opts.headroom) * 100)}% of the soft limit${ino ? ' and inotify watches ≤ the same share of max_user_watches' : ''}`,
    };

    // ── measurement 2 — repeated rebuild of one project, idle MCP session ───
    const target = projects[0];
    const projectApi = `/api/projects/${encodeURIComponent(target.id)}`;
    mcp = new Client({ name: 'measure-context-lifecycle', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}${projectApi}/mcp`));
    await mcp.connect(transport);
    const toolNames = (await mcp.listTools()).tools.map((t) => t.name);
    const firstCall = await mcp.callTool({ name: 'list_projects', arguments: {} });
    if (firstCall.isError) throw new Error(`list_projects on the MCP session failed: ${JSON.stringify(firstCall.content)}`);
    const sessionId = transport.sessionId;

    // The invalidation trigger of M13 `m13actv0`: a save of `entities` (a
    // `context-rebuild` field) with the CURRENT effective set, so every cycle
    // rebuilds the same project.
    const config = await api('GET', `${projectApi}/config`);
    const entities = Array.isArray(config.entities)
      ? config.entities
      : (await api('GET', `${projectApi}/_meta/types`)).types.map((t) => t.type);

    const cycles = [];
    for (let k = 0; k < opts.cycles; k++) {
      const t0 = Date.now();
      await api('PATCH', `${projectApi}/config`, { entities });
      // Served by the successor: the request waits in the queue for the rebuild.
      await api('GET', `${projectApi}/config`);
      const rebuildMs = Date.now() - t0;
      // The MCP session stays idle — no request on it during the cycles.
      await settle();
      cycles.push({ cycle: k + 1, rebuildMs, fds: openFds(), watchHandles: watchHandles(), ...heap() });
    }

    // The idle session still answers, from the live context, on the same session.
    const lastCall = await mcp.callTool({ name: 'list_projects', arguments: {} });
    const sessionAlive = !lastCall.isError && transport.sessionId === sessionId;

    const measured = cycles.slice(opts.warmup);
    const series = (key) => measured.map((c) => c[key]);
    const fdSeries = series('fds');
    const watchSeries = series('watchHandles');
    const heapSeries = series('heapUsed');
    const heapSlope = slope(heapSeries);
    const heapGrowth = heapSlope * Math.max(heapSeries.length - 1, 0);
    const heapTolerance = opts.heapToleranceMb * 1024 * 1024;
    const fdSpread = fdSeries.length ? Math.max(...fdSeries) - Math.min(...fdSeries) : 0;
    const fdFlat = fdSpread <= opts.fdTolerance && fdSeries.at(-1) - fdSeries[0] <= opts.fdTolerance;
    const watchFlat = new Set(watchSeries).size <= 1;
    const heapFlat = heapGrowth <= heapTolerance;
    result.flatLine = {
      project: target.id,
      mcpSession: { toolCount: toolNames.length, idleDuringCycles: true, answersAfter: sessionAlive },
      cycles,
      analysedFromCycle: opts.warmup + 1,
      fds: { first: fdSeries[0], last: fdSeries.at(-1), spread: fdSpread, slopePerCycle: Number(slope(fdSeries).toFixed(3)), flat: fdFlat },
      watchHandles: { values: [...new Set(watchSeries)], flat: watchFlat },
      heapUsed: {
        first: heapSeries[0],
        last: heapSeries.at(-1),
        slopeBytesPerCycle: Math.round(heapSlope),
        growthOverWindowBytes: Math.round(heapGrowth),
        toleranceBytes: heapTolerance,
        flat: heapFlat,
      },
      pass: fdFlat && watchFlat && heapFlat && sessionAlive,
      criterion: `after ${opts.warmup} warm-up cycles: FD spread ≤ ${opts.fdTolerance}, watch handles constant, heap trend over the window ≤ ${opts.heapToleranceMb} MiB, idle MCP session still answers`,
    };
    result.ok = result.fdBudget.pass && result.flatLine.pass;
    return { exit: result.ok ? 0 : 1, result };
  } catch (err) {
    result.error = err instanceof Error ? err.stack ?? err.message : String(err);
    return { exit: 2, result };
  } finally {
    await mcp?.close().catch(() => {});
    await server.shutdown().catch((err) => toStderr('[measure] shutdown failed:', String(err)));
    if (!opts.keep) fs.rmSync(tmp, { recursive: true, force: true });
    else result.workspaceDir = tmp;
  }
}

main()
  .then(({ exit, result }) => {
    // Exit only once the result is flushed — stdout to a pipe is asynchronous.
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, () => process.exit(exit));
  })
  .catch((err) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: err instanceof Error ? err.stack : String(err) })}\n`, () =>
      process.exit(2),
    );
  });
