import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PATCH_KINDS } from '../../../src/core/briefs/types.js';

/**
 * The `c4s-workflow-implementer` skill runs the loop that implements a
 * workflow brief. It took over the guards that left the
 * `layered-vertical-slices` style with its handbook: the loop reads the
 * specification only at the brief's window, and its deviations are the
 * patch kinds `c4s create-patch` accepts.
 *
 * The skill is a local, hand-edited copy for now (`.claude/skills/`); when the
 * system starts generating it, this test follows it to the template.
 */
describe('the c4s-workflow-implementer skill', () => {
  const ROOT = path.join(import.meta.dirname, '../../../.claude/skills/c4s-workflow-implementer');

  const files = (fs.readdirSync(ROOT, { recursive: true }) as string[])
    .filter((f) => fs.statSync(path.join(ROOT, f)).isFile())
    .sort()
    .map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')] as const);

  /**
   * Every CLI reader of pages and entities reads the live state, which by
   * implementation time has usually moved past the window's `to` end;
   * `release-diff` is the only read at a release. A live reader in the loop
   * would build a packet from a specification the brief never described.
   * `c4s catalog` and `c4s describe` stay allowed: set-up reads type
   * definitions through them, not specification content.
   */
  it('reads the specification only through release-diff, pinned to the window', () => {
    const live =
      /\bc4s (?:get-sections|get-entities|list-entities|get-page-outline|get-page|list-pages|search-pages|search-entities)\b|`(?:get-sections|get-entities|list-entities|get-page-outline)`/;
    expect(files.length).toBeGreaterThan(10);
    for (const [file, text] of files) {
      expect({ file, live: live.exec(text)?.[0] ?? null }).toEqual({ file, live: null });
    }
    const reading = files.find(([f]) => f === 'reading-the-spec.md')?.[1] ?? '';
    expect(reading).toContain('c4s release-diff --from initial --to <to>');
  });

  it('ships deviations with the patch kinds create-patch accepts, through the command that exists', () => {
    const deviation = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/deviation.json'), 'utf8'));
    expect([...deviation.properties.kind.enum].sort()).toEqual([...PATCH_KINDS].sort());
    for (const [file, text] of files) {
      expect({ file, phantom: text.includes('file-patch') }).toEqual({ file, phantom: false });
    }
  });

  /**
   * Which entity types a specification uses is the project's choice, made by
   * its plugins. The skill lives in a code repo and serves any specification,
   * so it speaks of roles (criteria, built, context) and learns the types from
   * the project at set-up. A type name in the skill is an assumption about a
   * project it cannot make; the guard takes the names from every plugin this
   * repo ships, so a new plugin's types are guarded too.
   */
  it('names no entity type: set-up learns them from the project', () => {
    const PLUGINS = path.join(import.meta.dirname, '../../../plugins');
    const types = fs
      .readdirSync(PLUGINS)
      .map((p) => path.join(PLUGINS, p, 'src/entity'))
      .filter((d) => fs.existsSync(d))
      .flatMap((d) => fs.readdirSync(d).filter((t) => fs.statSync(path.join(d, t)).isDirectory()));
    expect(types.length).toBeGreaterThan(5);
    const esc = (t: string) => t.replace(/[-]/g, '\\-');
    const named = new RegExp(
      `\`(?:${types.map(esc).join('|')})\`|--entity-types (?:${types.map(esc).join('|')})\\b|^\\s*-?\\s*(?:${types.map(esc).join('|')}):|\`verifies\``,
      'm',
    );
    for (const [file, text] of files) {
      expect({ file, named: named.exec(text)?.[0] ?? null }).toEqual({ file, named: null });
    }
  });

  /**
   * Some types are generic containers: one grid is a register to build,
   * another a note, a third a list of expected behaviour — and one grid can be
   * two of these. Set-up classifies such entities one by one, before any
   * implementer runs, so the builder never decides what it has to build.
   */
  it('classifies the entities of a per-entity type at set-up, part by part', () => {
    const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/state.json'), 'utf8'));
    expect(state.properties.entityTypes.items.properties.role.enum).toContain('per-entity');
    const part = state.properties.entityParts.items.properties.parts.items.properties;
    expect(part.role.enum).toEqual(['criteria', 'built', 'context']);
    const setup = files.find(([f]) => f === 'setup.md')?.[1] ?? '';
    expect(setup).toContain('`entityParts`');
  });

  it('ships schemas that parse', () => {
    const schemas = files.filter(([f]) => f.startsWith('schemas/') && f.endsWith('.json'));
    expect(schemas.map(([f]) => f)).toEqual(
      ['deviation', 'iteration-status', 'release', 'review', 'split', 'state', 'stubs', 'verdict'].map(
        (n) => `schemas/${n}.json`,
      ),
    );
    for (const [file, text] of schemas) expect(() => JSON.parse(text), file).not.toThrow();
  });

  /**
   * A verifier per portion re-read what the unit verifier reads again anyway
   * (every slug of the unit, plus its goal and the suite); in practice it
   * found almost nothing the unit verifier would not, at half the cost of
   * every portion. Verification lives at unit and system scope only.
   */
  it('verifies at unit and system scope only, never per portion', () => {
    const verdict = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/verdict.json'), 'utf8'));
    expect(verdict.properties.scope.properties.kind.enum).toEqual(['unit', 'system']);
    for (const [file, text] of files) {
      expect({ file, step: /verify-portion/.exec(text)?.[0] ?? null }).toEqual({ file, step: null });
    }
  });

  /**
   * Drives the reference driver's stub adapter to a stop in a throw-away repo:
   * one unit of two portions. Returns the exit codes, the git log and the gate.
   */
  function drive(opts: { app?: string; jobs?: { id: string; modules: string[] }[]; stub?: Record<string, unknown> } = {}) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-wi-'));
    const state = path.join(repo, '.c4s-impl');
    fs.cpSync(path.join(ROOT, 'schemas'), path.join(state, 'schemas'), { recursive: true });
    const writeJson = (rel: string, v: unknown) => {
      fs.mkdirSync(path.dirname(path.join(state, rel)), { recursive: true });
      fs.writeFileSync(path.join(state, rel), JSON.stringify(v, null, 2));
    };
    writeJson('release.json', {
      project: 'p', workspace: 'w', from: '1.0.0', to: '1.0.1', brief: 'briefs/b.md', harness: 'stub',
      build: {
        tests: { suite: 'true', filtered: 'true <pattern>', e2e: 'true <url> <pattern>', smoke: 'true <url>' },
        isolation: 'main-checkout', budget: {}, gates: [], review: 'per-unit', startMode: 'greenfield',
        app: opts.app ?? 'none',
      },
    });
    writeJson('state.json', {
      iteration: 0, conventions: [], entityTypes: [],
      waves: [{ n: 1, units: ['u01'], startCommit: null }],
      units: [{
        id: 'u01', goal: 'Build the thing.\nSecond line.', wave: 1, status: 'pending', dependsOn: [], portions: [],
        recipe: { pages: [], entities: [{ type: 'criterion', slugs: ['c-a', 'c-b'] }] },
        jobs: opts.jobs ?? [],
        startCommit: null, baseCommit: null, rounds: { review: 0, unit: 0 },
      }],
    });
    writeJson('stubs.json', { stubs: [] });
    writeJson('stub/implementer-split.json', {
      role: 'implementer', unit: 'u01', packetBytes: 300000,
      portions: [{ name: 'u01/p1-l1', slugs: ['c-a'] }, { name: 'u01/p2-l2', slugs: ['c-b'] }],
    });
    for (const [name, v] of Object.entries(opts.stub ?? {})) writeJson(`stub/${name}.json`, v);
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    };
    const sh = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: repo, env, encoding: 'utf8' });
    sh('git', ['init', '-q']);
    sh('git', ['commit', '-q', '--allow-empty', '-m', 'init']);

    const driver = path.join(ROOT, 'harness/driver-reference.mjs');
    const exits: (number | null)[] = [];
    for (let i = 0; i < 10; i++) {
      const r = sh('node', [driver, '--state-dir', '.c4s-impl', '--adapter', 'stub']);
      exits.push(r.status);
      if (r.status !== 10) break;
    }
    const log = sh('git', ['log', '--format=%s']).stdout.trim().split('\n');
    const gateFile = path.join(state, 'gate');
    const gate = fs.existsSync(gateFile) ? fs.readFileSync(gateFile, 'utf8').trim() : null;
    fs.rmSync(repo, { recursive: true, force: true });
    return { exits, log, gate };
  }

  /**
   * Per-iteration commits are checkpoints; a verified unit leaves one commit
   * on the branch. Two portions, unit review, system verify.
   */
  it('leaves one commit per verified unit', () => {
    const { exits, log } = drive();
    // split, p1, p2, verify-unit (squashed), verify-system (done)
    expect(exits).toEqual([10, 10, 10, 10, 0]);
    expect(log).toEqual(['verify(system) — 2/2', 'unit(u01): Build the thing. — 3/3', 'init']);
  });

  /**
   * A unit that owns a user job proves it end to end, as job:<id>, against the
   * running app. An app that does not come up is a stop for the human, never a
   * reopen: the loop cannot verify what it cannot run.
   */
  it('verifies a unit\'s jobs against the running app, and stops at a red smoke', () => {
    const jobs = [{ id: 'J1', modules: ['M01'] }];
    const green = drive({ app: 'command:true', jobs });
    expect(green.exits).toEqual([10, 10, 10, 10, 0]);
    expect(green.log[1]).toBe('unit(u01): Build the thing. — 4/4');

    const red = drive({ app: 'command:true', jobs, stub: { app: { url: 'stub://app', green: false } } });
    expect(red.exits).toEqual([10, 10, 10, 20]);
    expect(red.gate).toMatch(/^smoke red/);
  });

  /**
   * How tests run and how the app comes up are the project's choices: commands
   * in defaults.md, asked at set-up. The skill holds the mechanism only — no
   * project's test runner or environment service is named in it.
   */
  it('takes the e2e, smoke and app commands from defaults, and names no project tooling', () => {
    const release = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/release.json'), 'utf8'));
    const build = release.properties.build.properties;
    expect(Object.keys(build.tests.properties)).toEqual(expect.arrayContaining(['suite', 'filtered', 'e2e', 'smoke']));
    expect(build.app.type).toBe('string');
    const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/state.json'), 'utf8'));
    expect(state.properties.units.items.properties.jobs.type).toBe('array');
    const implementer = files.find(([f]) => f === 'roles/implementer.md')?.[1] ?? '';
    expect(implementer).toContain('`job:<id>`');
    for (const [file, text] of files) {
      expect({ file, tooling: /env-runner|envr\b|C4S_E2E|test:e2e/.exec(text)?.[0] ?? null }).toEqual({ file, tooling: null });
    }
  });
});
