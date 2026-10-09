#!/usr/bin/env node
// Reference driver for the c4s-workflow-implementer loop (headless harnesses).
//
//   node driver-reference.mjs [--dry-run] [--state-dir .c4s-impl] [--adapter <name>]
//
// One invocation = one resume(): read .c4s-impl/, derive ONE step, run its
// role(s), validate their JSON, write the state, ship deviations, commit once,
// exit. It reads nothing but .c4s-impl/ (and git HEAD); never the brief.
//
//   --dry-run   derive the step and print it as JSON; write nothing, run nothing.
//   --adapter   override release.json's harness: claude-code-headless | codex | stub.
//
// Exit codes: 0 done · 10 progressed · 20 gate · 30 waiting · 1 error.
// Terminal loop:  while node driver-reference.mjs; [ $? -eq 10 ]; do :; done
//
// Zero dependencies: Node >= 18, git, and (outside the stub adapter) c4s plus
// the harness CLI on PATH.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EXIT = { done: 0, progressed: 10, gate: 20, waiting: 30, error: 1 };

// ── arguments ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { dryRun: false, stateDir: '.c4s-impl', adapter: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--state-dir') opts.stateDir = argv[++i];
    else if (a === '--adapter') opts.adapter = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

// ── files ────────────────────────────────────────────────────────────────────

const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
};

/** Deviation files on disk — roles write them, so they are re-read before shipping. */
function loadDeviations(dir) {
  const devDir = path.join(dir, 'deviations');
  return fs.existsSync(devDir)
    ? fs.readdirSync(devDir).filter((f) => f.endsWith('.json')).sort()
        .map((f) => ({ file: path.join(devDir, f), ...readJson(path.join(devDir, f)) }))
    : [];
}

function loadContext(dir) {
  const release = readJson(path.join(dir, 'release.json'));
  if (!release) throw new Error(`${dir}/release.json missing — run setup first`);
  const deviations = loadDeviations(dir);
  const gateFile = path.join(dir, 'gate');
  return {
    dir,
    release,
    state: readJson(path.join(dir, 'state.json')),
    stubs: readJson(path.join(dir, 'stubs.json'), { stubs: [] }),
    deviations,
    gate: fs.existsSync(gateFile) ? fs.readFileSync(gateFile, 'utf8').trim() : null,
  };
}

// ── a minimal JSON-schema validator (the subset the skill's schemas use) ─────

function validate(schema, value, at = '$') {
  const errors = [];
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  if (schema.type) {
    const types = [].concat(schema.type);
    const t = typeOf(value);
    if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) {
      return [`${at}: expected ${types.join('|')}, got ${t}`];
    }
  }
  if (schema.anyOf && !schema.anyOf.some((branch) => validate(branch, value, at).length === 0)) {
    return [`${at}: matches no anyOf branch`];
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} not in enum`);
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: does not match ${schema.pattern}`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, `${at}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${at}: missing ${k}`);
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (sub) errors.push(...validate(sub, v, `${at}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: unexpected ${k}`);
    }
  }
  return errors;
}

function checked(ctx, schemaName, output) {
  if (output == null) return { valid: false, errors: ['no output'] };
  const schema = readJson(path.join(ctx.dir, 'schemas', `${schemaName}.json`));
  if (!schema) throw new Error(`${ctx.dir}/schemas/${schemaName}.json missing`);
  const errors = validate(schema, output);
  return { valid: errors.length === 0, errors, output };
}

// ── derivation (pure: reads ctx, returns the step) ───────────────────────────

const unitDone = (u) => u.status === 'verified';
const portionDone = (p) => p.status === 'implemented';
const orderedUnits = (state) =>
  state.units.map((u, i) => ({ u, i })).sort((a, b) => a.u.wave - b.u.wave || a.i - b.i).map((x) => x.u);

function terminate(ctx) {
  const { state, stubs, deviations } = ctx;
  return (
    state.units.every(unitDone) &&
    state.systemVerified === true &&
    stubs.stubs.every((s) => s.closed) &&
    deviations.every((d) => d.sent)
  );
}

function derive(ctx, { nextWindow }) {
  if (ctx.gate !== null) return { action: 'stop', status: 'gate', reason: ctx.gate || 'gate' };
  if (nextWindow) return { action: 'gate', reason: 'next window exists' };
  if (!ctx.state) return { action: 'gate', reason: 'state.json missing — run setup' };
  if (terminate(ctx)) return { action: 'stop', status: 'done' };

  const { state } = ctx;
  if (state.units.every(unitDone)) {
    if (!state.systemVerified) return { action: 'verify-system' };
    if (ctx.deviations.some((d) => !d.sent)) return { action: 'ship' };
    return { action: 'gate', reason: 'system verified, but stubs.json still has open rows' };
  }

  const verified = new Set(state.units.filter(unitDone).map((u) => u.id));
  const u =
    state.units.find((x) => x.status === 'in-progress') ??
    orderedUnits(state).find((x) => x.status === 'pending' && x.dependsOn.every((d) => verified.has(d.unit)));
  if (!u) return { action: 'stop', status: 'waiting', reason: 'every runnable unit is blocked' };

  const start = u.status === 'pending';
  // The one check that is global by nature: the repo, not the brief, before the first unit.
  const firstUnit = state.units.every((x) => !x.startCommit);
  if (firstUnit && ctx.release.build.startMode === 'resume' && !state.baselineGreen) return { action: 'baseline' };
  if (u.portions.length === 0) return { action: 'split', unit: u.id, start };

  // No verifier per portion: an in-progress portion (a run that stopped early) is implemented again.
  const p = u.portions.find((x) => !portionDone(x));
  if (p) {
    return {
      action: 'implement-portion',
      unit: u.id,
      portion: p.name,
      only: p.only ?? [],
      round: (p.rounds ?? 0) + 1,
      start,
    };
  }
  return { action: 'verify-unit', unit: u.id, review: ctx.release.build.review ?? 'off' };
}

// ── scopes handed to a role ──────────────────────────────────────────────────

function scopeBlock(ctx, role, scope) {
  const lines = [`\n## Scope of this run`, `- role: ${role}`, `- state dir: ${ctx.dir}`];
  for (const [k, v] of Object.entries(scope)) {
    lines.push(`- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  lines.push(`\nReturn only the JSON per \`${ctx.dir}/schemas/${scope.schema}.json\`.`);
  return lines.join('\n') + '\n';
}

function unitScope(u) {
  return { unit: u.id, goal: u.goal, recipe: u.recipe, jobs: u.jobs ?? [] };
}

// ── adapters: run(role, scope) → output JSON or null ─────────────────────────

const recipeSlugs = (u) => u.recipe.entities.flatMap((e) => e.slugs);

function stubAdapter(ctx) {
  const override = (name) => readJson(path.join(ctx.dir, 'stub', `${name}.json`), null);
  const release = `${ctx.release.from}..${ctx.release.to}`;
  return {
    name: 'stub',
    nextWindow: () => false,
    run(role, scope) {
      const o = override(scope.mode === 'split' ? `${role}-split` : role);
      if (o) return o;
      const u = ctx.state.units.find((x) => x.id === scope.unit);
      if (role === 'implementer' && scope.mode === 'split') {
        return { role: 'implementer', unit: u.id, packetBytes: 0, portions: [{ name: `${u.id}/p1`, slugs: recipeSlugs(u) }] };
      }
      if (role === 'implementer') return { role: 'implementer', status: 'progressed', release, unit: u.id, portion: scope.portion };
      if (role === 'reviewer') return { role: 'reviewer', scope: { kind: scope.kind, id: scope.id, base: scope.base ?? '' }, findings: [] };
      const rows = (scope.slugs ?? []).map((slug) => ({ slug, level: 2, status: 'covered', evidence: 'stub' }));
      const kind = role === 'verifier-system' ? 'system' : 'unit';
      const id = kind === 'system' ? 'system' : scope.unit;
      return { role, scope: { kind, id }, release, rows, suite: { command: 'stub', exitCode: 0 } };
    },
    suiteGreen: () => override('baseline')?.green ?? true,
    appUp: () => override('app')?.url ?? 'stub://app',
    smoke: () => ({ green: override('app')?.green ?? true, tail: 'stub' }),
    appDown: () => {},
    createPatch: (d) => `patches/stub-${d.id}.md`,
    markImplemented: () => {},
  };
}

function c4s(ctx, args) {
  const r = spawnSync('c4s', [...args, '--project', ctx.release.project, '--workspace', ctx.release.workspace], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`c4s ${args[0]} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

function cliAdapter(ctx, harness) {
  const budget = ctx.release.build.budget ?? {};
  const prompt = (role, scope, n) => {
    const scopeFile = path.join(ctx.dir, 'runs', `${n}-${role}.scope.md`);
    fs.mkdirSync(path.dirname(scopeFile), { recursive: true });
    fs.writeFileSync(scopeFile, scopeBlock(ctx, role, scope));
    const roleFile = role === 'verifier-system' ? 'verifier-system' : role;
    return fs.readFileSync(path.join(ctx.dir, 'prompts', `${roleFile}.md`), 'utf8') + fs.readFileSync(scopeFile, 'utf8');
  };
  return {
    name: harness,
    nextWindow() {
      const out = JSON.parse(c4s(ctx, ['list-briefs']));
      return out.items.some((b) => b.frontmatter?.from_release === ctx.release.to);
    },
    run(role, scope) {
      const n = ctx.state.iteration ?? 0;
      const schemaFile = path.join(ctx.dir, 'schemas', `${scope.schema}.json`);
      const text = prompt(role, scope, n);
      const limitKey = role === 'verifier-system' ? 'verifier' : role;
      if (harness === 'claude-code-headless') {
        const r = spawnSync('claude', [
          '-p', text, '--output-format', 'json', '--json-schema', fs.readFileSync(schemaFile, 'utf8'),
          '--permission-mode', 'dontAsk', '--max-turns', String(budget[limitKey] ?? 40),
          ...toolFlags(ctx, role),
        ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        if (r.status !== 0 && !r.stdout) throw new Error(`claude -p exited ${r.status}: ${r.stderr}`);
        try { return JSON.parse(r.stdout).structured_output ?? null; } catch { return null; }
      }
      if (harness === 'codex') {
        const outFile = path.join(ctx.dir, 'runs', `${n}-${role}.json`);
        const r = spawnSync('codex', [
          'exec', text, '--json', '--output-schema', schemaFile, '-o', outFile,
          '--sandbox', 'workspace-write', '--ignore-user-config',
        ], { encoding: 'utf8', timeout: (budget[limitKey] ?? 30) * 60_000, maxBuffer: 64 * 1024 * 1024 });
        if (r.error?.code === 'ETIMEDOUT') return null;
        if (r.status !== 0) throw new Error(`codex exec exited ${r.status}: ${r.stderr}`);
        try { return JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { return null; }
      }
      throw new Error(`unknown harness ${harness}`);
    },
    createPatch(d, bodyFile) {
      const out = JSON.parse(c4s(ctx, [
        'create-patch', '--brief', ctx.release.brief, '--kind', d.kind,
        '--desc', `${d.address}: ${d.text.split('\n')[0].slice(0, 80)}`, '--body-file', bodyFile,
      ]));
      return out.path ?? out.patchPath ?? 'filed';
    },
    suiteGreen: () => spawnSync(ctx.release.build.tests.suite, { shell: true, stdio: 'inherit' }).status === 0,
    appUp() {
      const app = ctx.release.build.app ?? 'none';
      if (!app.startsWith('command:')) throw new Error(`app ${app}: a driver brings the app up only with command:<cmd>`);
      const r = spawnSync(app.slice('command:'.length), { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      return r.status === 0 ? r.stdout.trim().split('\n').pop()?.trim() || null : null;
    },
    smoke(url) {
      const r = spawnSync(ctx.release.build.tests.smoke.replaceAll('<url>', url), { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      return { green: r.status === 0, tail: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-5).join('\n') };
    },
    appDown() {
      const down = ctx.release.build.appDown ?? 'keep';
      if (down.startsWith('command:')) spawnSync(down.slice('command:'.length), { shell: true, stdio: 'inherit' });
    },
    markImplemented: () => c4s(ctx, ['mark-brief-implemented', ctx.release.brief]),
  };
}

function toolFlags(ctx, role) {
  const t = ctx.release.build.tests;
  const filtered = t.filtered.replace('<pattern>', '*');
  if (role === 'implementer') {
    return ['--allowedTools', `Read,Edit,Write,Glob,Grep,Bash(c4s *),Bash(${filtered}),Bash(${t.suite}),Bash(git status*),Bash(git diff*)`,
      '--disallowedTools', 'Agent,AskUserQuestion'];
  }
  if (role === 'reviewer') {
    return ['--allowedTools', `Read,Glob,Grep,Write(${ctx.dir}/deviations/*),Bash(git diff*),Bash(git log*)`,
      '--disallowedTools', 'Edit,Agent,AskUserQuestion'];
  }
  const mcp = path.join(ctx.dir, 'mcp.json');
  const e2e = t.e2e ? `,Bash(${t.e2e.replace(/<url>|<pattern>/g, '*')})` : '';
  return ['--allowedTools', `Read,Glob,Grep,Bash(c4s *),Bash(${filtered}),Bash(${t.suite})${e2e}`,
    '--disallowedTools', 'Edit,Write,Agent,AskUserQuestion', ...(fs.existsSync(mcp) ? ['--mcp-config', mcp] : [])];
}

function adapterFor(ctx, name) {
  const harness = name ?? ctx.release.harness;
  if (harness === 'stub') return stubAdapter(ctx);
  if (harness === 'claude-code-headless' || harness === 'codex') return cliAdapter(ctx, harness);
  throw new Error(`harness ${harness} has no driver adapter (a session harness is driven by the session)`);
}

// ── execution ────────────────────────────────────────────────────────────────

const git = (...args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
  return r.stdout.trim();
};

function writeGate(ctx, reason) {
  fs.writeFileSync(path.join(ctx.dir, 'gate'), reason + '\n');
  ctx.gate = reason;
}

function nextDeviationId(ctx) {
  const n = ctx.deviations.reduce((m, d) => Math.max(m, Number(d.id?.slice(4)) || 0), 0) + 1;
  return `dev-${String(n).padStart(4, '0')}`;
}

function blockingDeviation(ctx, u, text) {
  const d = { id: nextDeviationId(ctx), kind: 'clarification', blocking: true, address: u.id, text, unit: u.id, sent: false };
  writeJson(path.join(ctx.dir, 'deviations', `${d.id}.json`), d);
  ctx.deviations.push({ file: path.join(ctx.dir, 'deviations', `${d.id}.json`), ...d });
  return d;
}

/** Run one role and validate its output; invalid output is stoppedEarly (null). */
function runRole(ctx, adapter, role, scope) {
  const out = adapter.run(role, scope);
  const res = checked(ctx, scope.schema, out);
  if (!res.valid) {
    fs.mkdirSync(path.join(ctx.dir, 'runs'), { recursive: true });
    fs.writeFileSync(path.join(ctx.dir, 'runs', `${ctx.state.iteration}-${role}.invalid.txt`), res.errors.join('\n') + '\n');
    return null;
  }
  return res.output;
}

const failed = (verdict) => verdict.rows.filter((r) => r.status !== 'covered');

// an item of a per-entity entity (<slug>#<key value>) belongs where its entity does
const entityOf = (slug) => slug.split('#')[0];

function ownerPortion(u, slug) {
  return u.portions.find((p) => p.slugs.includes(entityOf(slug))) ?? u.portions[u.portions.length - 1];
}

function reopen(u, items, head) {
  const byPortion = new Map();
  for (const { portion, item } of items) {
    const p = u.portions.find((x) => x.name === portion) ?? u.portions[u.portions.length - 1];
    byPortion.set(p, [...(byPortion.get(p) ?? []), item]);
  }
  for (const [p, only] of byPortion) {
    p.status = 'pending';
    p.only = only;
    p.uncovered = only.filter((x) => x.slug).map((x) => x.slug);
  }
  u.status = 'in-progress';
  u.startCommit = head;
}

function verifyUnit(ctx, u) {
  u.status = 'verified';
  u.blockedBy = null;
  const packets = path.join(ctx.dir, 'packets');
  if (fs.existsSync(packets)) {
    for (const f of fs.readdirSync(packets)) if (f.startsWith(`${u.id}`)) fs.rmSync(path.join(packets, f), { force: true });
  }
  for (const s of ctx.stubs.stubs) if (s.provider === u.id) s.closed = true;
}

function review(ctx, adapter, kind, id, units, base) {
  const r = runRole(ctx, adapter, 'reviewer', {
    schema: 'review', kind, id, base,
    goal: units.map((u) => `${u.id}: ${u.goal}`).join(' | '),
    diff: `git diff ${base}..HEAD`,
  });
  if (!r) return null;
  writeJson(path.join(ctx.dir, 'review', `${id}.json`), r);
  const notes = r.findings.filter((f) => !f.blocking);
  if (notes.length) {
    fs.appendFileSync(path.join(ctx.dir, 'review', `${id}.md`),
      notes.map((f) => `- ${f.file}:${f.line} — ${f.reason}`).join('\n') + '\n');
  }
  return r.findings.filter((f) => f.blocking);
}

function applyReview(ctx, u, blocking, head) {
  u.rounds = u.rounds ?? {};
  const prev = u.lastBlocking ?? Infinity;
  if (blocking.length === 0) {
    u.rounds.review = 0;
    verifyUnit(ctx, u);
    return;
  }
  u.rounds.review = (u.rounds.review ?? 0) + 1;
  if (u.rounds.review >= stuckRounds(ctx) && blocking.length >= prev) {
    u.status = 'blocked';
    u.blockedBy = 'review';
    writeGate(ctx, `review: ${u.id}`);
    return;
  }
  reopen(u, blocking.map((f) => ({ portion: f.portion, item: { finding: f.id } })), head);
}

const stuckRounds = (ctx) => ctx.release.build.stuckRounds ?? 3;

// ── the running app: brought up only for the scopes that run against it ──────

const appOn = (ctx) => (ctx.release.build.app ?? 'none') !== 'none';

function needsApp(ctx, u) {
  if (!appOn(ctx)) return false;
  if ((u.jobs ?? []).length) return true;
  const e2eTypes = new Set((ctx.state.entityTypes ?? [])
    .filter((t) => t.role === 'criteria' && ['e2e', 'per-criterion'].includes(t.observedIn)).map((t) => t.type));
  return u.recipe.entities.some((e) => e2eTypes.has(e.type));
}

/** The app at HEAD, smoke-tested. False (and a gate) when it is not up: a stop, never a reopen. */
function ensureApp(ctx, adapter, head) {
  const { state } = ctx;
  if (state.app?.commit !== head || !state.app?.url) state.app = { url: adapter.appUp(), commit: head };
  const smoke = state.app.url ? adapter.smoke(state.app.url) : { green: false, tail: 'the app did not come up' };
  state.app.smokeGreen = smoke.green;
  if (!smoke.green) writeGate(ctx, `smoke red: ${smoke.tail}`);
  return smoke.green;
}

/** True when a checkpoint of the unit is already upstream: those are never rewritten. */
function pushedSince(base) {
  if (spawnSync('git', ['rev-parse', '--abbrev-ref', '@{u}'], { encoding: 'utf8' }).status !== 0) return false;
  const oldest = git('rev-list', '--reverse', `${base}..HEAD`).split('\n').filter(Boolean)[0];
  return oldest !== undefined && spawnSync('git', ['merge-base', '--is-ancestor', oldest, '@{u}']).status === 0;
}

function execute(ctx, adapter, step) {
  const { state } = ctx;
  const head = git('rev-parse', 'HEAD');
  let scopeLabel = step.unit ?? 'system';
  let tally = '';

  const u = step.unit ? state.units.find((x) => x.id === step.unit) : null;
  if (u && step.start) {
    u.status = 'in-progress';
    u.startCommit = head;
    u.baseCommit = head;
    const wave = state.waves.find((w) => w.n === u.wave);
    if (wave && !wave.startCommit) wave.startCommit = head;
  }

  if (step.action === 'gate') {
    writeGate(ctx, step.reason);
    return 'gate';
  }

  if (step.action === 'baseline') {
    if (adapter.suiteGreen()) {
      if (appOn(ctx) && !ensureApp(ctx, adapter, head)) return finish(ctx, adapter, 'baseline: smoke red');
      state.baselineGreen = true;
      return finish(ctx, adapter, 'baseline: suite green');
    }
    writeGate(ctx, 'red baseline: the suite is red before the first unit');
    return finish(ctx, adapter, 'baseline: suite red');
  }

  if (step.action === 'split') {
    const split = runRole(ctx, adapter, 'implementer', { schema: 'split', mode: 'split', ...unitScope(u) });
    if (!split) return finish(ctx, adapter, `split(${u.id}): stopped early`);
    if (split.portions.length === 0) {
      // A read of the recipe did not hold: this unit waits on the specification, the others go on.
      const blocking = loadDeviations(ctx.dir).find((d) => (split.deviations ?? []).includes(d.id) && d.blocking);
      u.status = 'blocked';
      u.blockedBy = blocking?.id ?? blockingDeviation(ctx, u, 'split returned no portions and no blocking deviation').id;
      return finish(ctx, adapter, `split(${u.id}): blocked by ${u.blockedBy}`);
    }
    u.portions = split.portions.map((p) => ({ ...p, status: 'pending', rounds: 0, uncovered: [], only: [] }));
    return finish(ctx, adapter, `split(${u.id}): ${u.portions.length} portions`);
  }

  if (step.action === 'implement-portion') {
    const p = u.portions.find((x) => x.name === step.portion);
    scopeLabel = p.name;
    const scope = { ...unitScope(u), portion: p.name, slugs: p.slugs, layers: p.layers ?? [] };
    p.status = 'in-progress';
    writeJson(path.join(ctx.dir, 'state.json'), state); // a crash from here on runs the implementer again
    const status = runRole(ctx, adapter, 'implementer', { schema: 'iteration-status', mode: 'build', ...scope, only: p.only ?? [] });
    if (status?.status === 'error') throw new Error(`implementer ${p.name}: ${status.error ?? 'error'}`);
    if (status?.status === 'waiting') {
      u.status = 'blocked';
      u.blockedBy = status.deviations?.[0] ?? 'waiting';
      return finish(ctx, adapter, `impl(${p.name}): waiting`);
    }
    if (!status || status.stoppedEarly) {
      // The work so far is in the repo; the next iteration finishes it.
      p.partial = (p.partial ?? 0) + 1;
      if (p.partial >= stuckRounds(ctx)) {
        u.status = 'blocked';
        u.blockedBy = 'stuck';
        blockingDeviation(ctx, u, `portion ${p.name} stopped early ${p.partial} times in a row`);
        writeGate(ctx, `stuck: ${p.name}`);
      }
      return finish(ctx, adapter, `impl(${p.name}): stopped early (${p.partial})`);
    }
    p.status = 'implemented';
    p.rounds = (p.rounds ?? 0) + 1;
    p.partial = 0;
    p.only = [];
    return finish(ctx, adapter, `impl(${p.name}): round ${p.rounds}`);
  }

  if (step.action === 'verify-unit') {
    const app = needsApp(ctx, u);
    if (app && !ensureApp(ctx, adapter, head)) return finish(ctx, adapter, `verify(${u.id}): smoke red`);
    const slugs = [...u.portions.flatMap((p) => p.slugs), `goal:${u.id}`, ...(u.jobs ?? []).map((j) => `job:${j.id}`)];
    const verdict = runRole(ctx, adapter, 'verifier', { schema: 'verdict', ...unitScope(u), slugs, ...(app ? { app: state.app.url } : {}) });
    if (!verdict) return finish(ctx, adapter, `verify(${u.id}): stopped early`);
    const open = failed(verdict);
    tally = ` — ${verdict.rows.length - open.length}/${verdict.rows.length}`;
    u.rounds = u.rounds ?? {};
    u.rounds.unit = (u.rounds.unit ?? 0) + 1;
    if (open.length) {
      const prev = u.lastUncovered ?? Infinity;
      u.lastUncovered = open.length;
      if (u.rounds.unit >= stuckRounds(ctx) && open.length >= prev) {
        u.status = 'blocked';
        u.blockedBy = 'stuck';
        blockingDeviation(ctx, u, `unit ${u.id} stuck after ${u.rounds.unit} rounds: ${open.map((r) => r.slug).join(', ')}`);
        writeGate(ctx, `stuck: ${u.id}`);
        return finish(ctx, adapter, `verify(${u.id}): stuck${tally}`);
      }
      reopen(u, open.map((r) => ({ portion: ownerPortion(u, r.slug).name, item: { slug: r.slug } })), head);
      return finish(ctx, adapter, `verify(${u.id}): reopened${tally}`);
    }
    u.lastUncovered = 0;
    if (step.review === 'per-unit') {
      const blocking = review(ctx, adapter, 'unit', u.id, [u], u.startCommit ?? head);
      if (!blocking) return finish(ctx, adapter, `review(${u.id}): stopped early`);
      applyReview(ctx, u, blocking, head);
      u.lastBlocking = blocking.length;
    } else {
      verifyUnit(ctx, u);
    }
    const wave = state.waves.find((w) => w.n === u.wave);
    const waveUnits = state.units.filter((x) => x.wave === u.wave);
    if (u.status === 'verified' && waveUnits.every(unitDone)) {
      if (step.review === 'per-wave') {
        const blocking = review(ctx, adapter, 'wave', `wave-${u.wave}`, waveUnits, wave?.startCommit ?? head);
        for (const f of blocking ?? []) {
          const owner = waveUnits.find((x) => x.portions.some((p) => p.name === f.portion)) ?? u;
          reopen(owner, [{ portion: f.portion, item: { finding: f.id } }], head);
        }
      }
      const gates = ctx.release.build.gates ?? [];
      const allVerified = waveUnits.every(unitDone);
      if (allVerified && (gates.includes('wave') || (gates.includes('wave0') && u.wave === 0))) {
        writeGate(ctx, `wave ${u.wave} done`);
      }
    }
    if (u.status === 'verified') ctx.squash = { unit: u, tally };
    return finish(ctx, adapter, `verify(${u.id})${tally}`);
  }

  if (step.action === 'verify-system') {
    if (appOn(ctx) && !ensureApp(ctx, adapter, head)) return finish(ctx, adapter, 'verify(system): smoke red');
    const slugs = state.units.flatMap((x) => x.portions.flatMap((p) => p.slugs));
    const verdict = runRole(ctx, adapter, 'verifier-system', {
      schema: 'verdict', unit: 'system', slugs, ...(appOn(ctx) ? { app: state.app.url } : {}),
    });
    if (!verdict) return finish(ctx, adapter, 'verify(system): stopped early');
    const open = failed(verdict);
    tally = ` — ${verdict.rows.length - open.length}/${verdict.rows.length}`;
    if (open.length === 0) {
      state.systemVerified = true;
    } else {
      for (const r of open) {
        const job = r.slug.startsWith('job:') ? r.slug.slice(4) : null;
        const owner = job
          ? state.units.find((x) => (x.jobs ?? []).some((j) => j.id === job))
          : state.units.find((x) => x.portions.some((p) => p.slugs.includes(entityOf(r.slug))));
        if (owner) reopen(owner, [{ portion: ownerPortion(owner, r.slug).name, item: { slug: r.slug } }], head);
        else writeGate(ctx, `system: ${r.slug} has no owning unit`);
      }
    }
    scopeLabel = 'system';
    return finish(ctx, adapter, `verify(system)${tally}`);
  }

  if (step.action === 'ship') return finish(ctx, adapter, 'ship: deviations');
  throw new Error(`unknown step ${step.action}`);
}

/** Ship deviations, count the iteration, write the state, commit once. */
function finish(ctx, adapter, message) {
  const { state } = ctx;
  ctx.deviations = loadDeviations(ctx.dir);
  for (const d of ctx.deviations.filter((x) => !x.sent)) {
    const body = path.join(ctx.dir, 'deviations', `${d.id}.md`);
    fs.writeFileSync(body, `## What I found\n\n${d.text}\n\n## Suggestion\n\n${d.assumption ?? 'See the text above.'}\n`);
    try {
      d.patchPath = adapter.createPatch(d, body);
      d.sent = true;
    } catch (e) {
      process.stderr.write(`deviation ${d.id} not sent: ${e.message}\n`);
    }
    const { file, ...rest } = d;
    writeJson(file, rest);
  }
  state.iteration = (state.iteration ?? 0) + 1;
  state.errors = 0;
  const every = (ctx.release.build.gates ?? []).map((g) => /^every:(\d+)$/.exec(g)).find(Boolean);
  if (every && state.iteration % Number(every[1]) === 0 && !ctx.gate) writeGate(ctx, `every ${every[1]} iterations`);
  writeJson(path.join(ctx.dir, 'state.json'), state);
  writeJson(path.join(ctx.dir, 'stubs.json'), ctx.stubs);
  if (state.units.every(unitDone) && state.systemVerified && !ctx.markedImplemented && terminate(ctx)) {
    adapter.markImplemented();
    ctx.markedImplemented = true;
    if (appOn(ctx)) adapter.appDown();
  }
  git('add', '-A');
  if (ctx.squash) {
    // One commit per unit: the unit's checkpoints and this iteration become `unit(<id>)`.
    const { unit, tally } = ctx.squash;
    if (unit.baseCommit && !pushedSince(unit.baseCommit)) git('reset', '--soft', unit.baseCommit);
    message = `unit(${unit.id}): ${unit.goal.split('\n')[0].slice(0, 72)}${tally}`;
    ctx.squash = null;
  }
  git('commit', '--allow-empty', '-q', '-m', message);
  if (ctx.gate) return 'gate';
  return terminate(ctx) ? 'done' : 'progressed';
}

// ── main ─────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const ctx = loadContext(opts.stateDir);
  const adapter = adapterFor(ctx, opts.adapter);
  const nextWindow = ctx.gate === null && adapter.nextWindow();
  const step = derive(ctx, { nextWindow });

  if (opts.dryRun) {
    process.stdout.write(JSON.stringify(step, null, 2) + '\n');
    return EXIT[step.status ?? (step.action === 'gate' ? 'gate' : 'progressed')];
  }
  if (step.action === 'stop') {
    process.stdout.write(JSON.stringify(step) + '\n');
    return EXIT[step.status];
  }
  try {
    const status = execute(ctx, adapter, step);
    process.stdout.write(JSON.stringify({ ...step, result: status }) + '\n');
    return EXIT[status];
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    if (ctx.state) {
      ctx.state.errors = (ctx.state.errors ?? 0) + 1;
      if (ctx.state.errors > (ctx.release.build.retries?.error ?? 2)) writeGate(ctx, `error: ${e.message}`);
      writeJson(path.join(ctx.dir, 'state.json'), ctx.state);
    }
    return EXIT.error;
  }
}

process.exitCode = main();
