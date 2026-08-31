import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { configPath, type Config } from '../config.js';
import { configRouter } from './config.js';
import type { SkillRegistry } from '../services/skill-registry.js';

// 0.1.103: deterministic stand-in for probePathScope so agent.pathScopeStrength
// assertions don't depend on whether the CI/dev host actually has an OS sandbox
// (sandbox-exec/bwrap) available.
const hoisted = vi.hoisted(() => ({ strength: 'soft' as 'hard' | 'soft' | 'none' }));
vi.mock('@inharness-ai/agent-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inharness-ai/agent-adapters')>();
  return {
    ...actual,
    probePathScope: (...args: Parameters<typeof actual.probePathScope>) => ({
      ...actual.probePathScope(...args),
      strength: hoisted.strength,
    }),
  };
});

// 0.1.91 — the project `name` is display-only (folder identity is sha1(cwd), not the
// name), so the PATCH /config DTO accepts full Unicode and rejects only control chars.
describe('PATCH /config — name accepts full Unicode, rejects control chars (0.1.91)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-route-'));
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 3, name: 'X' }));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const app = () => {
    // A name-only PATCH never touches the writing-style registry, so an empty stub suffices.
    const router = configRouter({ cwd: dir, skillRegistry: {} as unknown as SkillRegistry });
    return express().use(express.json()).use(router);
  };

  it('accepts a Unicode name (diacritics, CJK, emoji) and persists it', async () => {
    const name = 'Zażółć 项目 🚀';
    const res = await request(app()).patch('/config').send({ name });
    expect(res.status).toBe(200);
    expect((res.body as Config).name).toBe(name);
  });

  it('rejects a name containing a control character with a 400', async () => {
    const res = await request(app()).patch('/config').send({ name: 'bad\nname' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects an over-long (>80) name with a 400', async () => {
    const res = await request(app()).patch('/config').send({ name: 'a'.repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});

// 0.1.103 — `agent.pathScopeStrength` mirrors agent-turn.ts's exact
// pathScopeRequested gate (empty ⇒ 'none'), then reflects the real probed
// runtime strength. probePathScope itself is mocked so the assertions don't
// depend on whether the test host actually has an OS sandbox (sandbox-exec/
// bwrap) available — that logic is agent-adapters' own, already covered there.
describe('GET/PATCH /config — agent.pathScopeStrength (0.1.103)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-route-strength-'));
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 4, name: 'X' }));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const app = () => {
    const router = configRouter({ cwd: dir, skillRegistry: {} as unknown as SkillRegistry });
    return express().use(express.json()).use(router);
  };

  it("returns 'none' when no paths are configured, regardless of host sandbox support", async () => {
    const res = await request(app()).get('/config');
    expect(res.status).toBe(200);
    expect(res.body.agent.pathScopeStrength).toBe('none');
  });

  it("returns 'hard' once a scope is configured when the mocked probe reports hard", async () => {
    hoisted.strength = 'hard';
    const res = await request(app())
      .patch('/config')
      .send({ agent: { allowedPaths: ['/allowed/dir'] } });
    expect(res.status).toBe(200);
    expect(res.body.agent.pathScopeStrength).toBe('hard');
  });

  it("returns 'soft' once a scope is configured when the mocked probe reports soft", async () => {
    hoisted.strength = 'soft';
    const res = await request(app())
      .patch('/config')
      .send({ agent: { disallowedPaths: ['/deny/dir'] } });
    expect(res.status).toBe(200);
    expect(res.body.agent.pathScopeStrength).toBe('soft');
  });

  it('recomputes pathScopeStrength on an unrelated agent PATCH while preserving previously-set paths', async () => {
    hoisted.strength = 'hard';
    await request(app())
      .patch('/config')
      .send({ agent: { allowedPaths: ['/allowed/dir'] } });

    const res = await request(app())
      .patch('/config')
      .send({ agent: { claudeUsePreset: false } });
    expect(res.status).toBe(200);
    expect(res.body.agent.allowedPaths).toEqual(['/allowed/dir']);
    expect(res.body.agent.pathScopeStrength).toBe('hard');
  });

  /**
   * 0.2.53 — the field, and the deep-merge that has to keep carrying it.
   *
   * The onboarding submit sends `agent: { conversationalLanguage }` and nothing
   * else; if that wiped the branch, every freshly-onboarded project would lose
   * the posture it was created with. This is the regression that guards it.
   */
  it('defaults disableDirectFilesystemAccess to true when the file omits it', async () => {
    const res = await request(app()).get('/config');
    expect(res.status).toBe(200);
    expect(res.body.agent.disableDirectFilesystemAccess).toBe(true);
  });

  it('round-trips disableDirectFilesystemAccess through PATCH', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ agent: { disableDirectFilesystemAccess: false } });
    expect(res.status).toBe(200);
    expect(res.body.agent.disableDirectFilesystemAccess).toBe(false);
  });

  it('rejects a non-boolean disableDirectFilesystemAccess', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ agent: { disableDirectFilesystemAccess: 'yes' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  /**
   * 0.2.53 — `strength` must not fall through to 'hard' on an empty report set.
   * `[].every(...)` is `true` and `[].some(...)` is `false`, so the reducer's
   * natural shape claims the strongest possible gate for a project with NO gate.
   */
  it("reports toolGating strength 'none' when the flag is off and nothing is gated", async () => {
    await request(app())
      .patch('/config')
      .send({ agent: { disableDirectFilesystemAccess: false } });
    const res = await request(app()).get('/config');
    expect(res.status).toBe(200);
    expect(res.body.agent.toolGating.strength).toBe('none');
    expect(res.body.agent.toolGating.escapeSurfaces).toEqual([]);
  });

  it('preserves disableDirectFilesystemAccess across the onboarding-shaped agent PATCH', async () => {
    await request(app())
      .patch('/config')
      .send({ agent: { disableDirectFilesystemAccess: false } });

    const res = await request(app())
      .patch('/config')
      .send({ agent: { conversationalLanguage: null } });
    expect(res.status).toBe(200);
    expect(res.body.agent.disableDirectFilesystemAccess).toBe(false);
  });

  /**
   * The badge's data source. It must never claim `hard`: the tools are removed
   * from the model's catalog, which is a model-behaviour gate, not a sandbox.
   */
  it('reports soft tool-gating strength with a named escape surface', async () => {
    const res = await request(app()).get('/config');
    expect(res.body.agent.toolGating.enforceable).toBe(true);
    expect(res.body.agent.toolGating.strength).not.toBe('hard');
    expect(res.body.agent.toolGating.escapeSurfaces.length).toBeGreaterThan(0);
  });
});

// 0.1.125 — commit-target validation. `commitTarget`/`switchAfterRelease`
// default to `{mode:'current', branch:null, template:null, base:null}`/
// `false`; PATCH deep-merges `commitTarget` one level deeper (precedent:
// `plugins[<name>]`) and rejects semantically-invalid `named`/`new` bodies.
describe('PATCH /config — git.commitTarget (0.1.125)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-route-git-'));
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 4, name: 'test' }));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const app = () => {
    const router = configRouter({ cwd: dir, skillRegistry: {} as unknown as SkillRegistry });
    return express().use(express.json()).use(router);
  };

  it('GET /config defaults commitTarget to mode "current" and switchAfterRelease to false', async () => {
    const res = await request(app()).get('/config');
    expect(res.status).toBe(200);
    expect(res.body.git.commitTarget).toEqual({ mode: 'current', branch: null, template: null, base: null });
    expect(res.body.git.switchAfterRelease).toBe(false);
  });

  it('rejects an unknown commitTarget.mode with 400', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ git: { commitTarget: { mode: 'bogus' } } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects mode "named" with no branch', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ git: { commitTarget: { mode: 'named' } } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects mode "named" with an empty-string branch', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ git: { commitTarget: { mode: 'named', branch: '' } } });
    expect(res.status).toBe(400);
  });

  it('accepts mode "named" with a branch', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ git: { commitTarget: { mode: 'named', branch: 'release' } } });
    expect(res.status).toBe(200);
    expect(res.body.git.commitTarget).toEqual({ mode: 'named', branch: 'release', template: null, base: null });
  });

  it('rejects mode "new" with no template', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ git: { commitTarget: { mode: 'new' } } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects mode "new" whose rendered template is not a valid git ref name', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ git: { commitTarget: { mode: 'new', template: 'bad ref name' } } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('accepts mode "new" with a valid placeholder template and optional base', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ git: { commitTarget: { mode: 'new', template: 'release/{release_slug}', base: 'main' } } });
    expect(res.status).toBe(200);
    expect(res.body.git.commitTarget).toEqual({
      mode: 'new',
      branch: null,
      template: 'release/{release_slug}',
      base: 'main',
    });
  });

  it('deep-merges commitTarget — patching only branch preserves a previously-set mode', async () => {
    await request(app())
      .patch('/config')
      .send({ git: { commitTarget: { mode: 'named', branch: 'release' } } });

    const res = await request(app())
      .patch('/config')
      .send({ git: { commitTarget: { branch: 'release-v2' } } });
    expect(res.status).toBe(200);
    expect(res.body.git.commitTarget).toEqual({
      mode: 'named',
      branch: 'release-v2',
      template: null,
      base: null,
    });
  });

  it('accepts switchAfterRelease and rejects a non-boolean value', async () => {
    const ok = await request(app()).patch('/config').send({ git: { switchAfterRelease: true } });
    expect(ok.status).toBe(200);
    expect(ok.body.git.switchAfterRelease).toBe(true);

    const bad = await request(app()).patch('/config').send({ git: { switchAfterRelease: 'yes' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION');
  });

  it('rejects a partial PATCH that would null out `branch` while a saved mode:"named" survives (code review regression)', async () => {
    const first = await request(app())
      .patch('/config')
      .send({ git: { commitTarget: { mode: 'named', branch: 'release' } } });
    expect(first.status).toBe(200);

    // `mode` omitted — validated against the EFFECTIVE (merged) commitTarget,
    // not just this request's body, so this must still be rejected: the
    // persisted mode stays 'named', which requires a non-empty branch.
    const res = await request(app())
      .patch('/config')
      .send({ git: { commitTarget: { branch: null } } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');

    // And the original setting must be untouched by the rejected request.
    const after = await request(app()).get('/config');
    expect(after.body.git.commitTarget).toEqual({ mode: 'named', branch: 'release', template: null, base: null });
  });

  it('accepts a mode "new" template using the documented {release_name} placeholder (code review regression)', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ git: { commitTarget: { mode: 'new', template: 'release-{release_name}' } } });
    expect(res.status).toBe(200);
    expect(res.body.git.commitTarget.template).toBe('release-{release_name}');
  });
});

// 0.2.8 (C17): `plansDir` gained a control in Settings → Directories. The
// screen sends a DIFF-ONLY payload, so the artifact-dir collision guard has to
// fire on a PATCH that carries no `roots` — which is exactly the shape it used
// to skip (the collision then surfaced only as a boot-time failure).
describe('PATCH /config — plansDir is editable and collision-checked (C17, 0.2.8)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-plans-'));
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 4, name: 'test' }));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const app = () => {
    const router = configRouter({ cwd: dir, skillRegistry: {} as unknown as SkillRegistry });
    return express().use(express.json()).use(router);
  };

  it('accepts and persists a plansDir change on its own', async () => {
    const res = await request(app()).patch('/config').send({ plansDir: '.claude4spec/roadmap' });
    expect(res.status).toBe(200);
    expect((res.body as Config).plansDir).toBe('.claude4spec/roadmap');
    const onDisk = JSON.parse(fs.readFileSync(configPath(dir), 'utf8')) as Config;
    expect(onDisk.plansDir).toBe('.claude4spec/roadmap');
  });

  it('rejects plansDir equal to briefsDir even without roots in the body', async () => {
    const res = await request(app()).patch('/config').send({ plansDir: '.claude4spec/briefs' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(/briefsDir and plansDir must differ/);
  });

  it('rejects plansDir equal to patchesDir even without roots in the body', async () => {
    const res = await request(app()).patch('/config').send({ plansDir: '.claude4spec/patches' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/patchesDir and plansDir must differ/);
  });

  it('rejects a plansDir escaping the project root', async () => {
    const res = await request(app()).patch('/config').send({ plansDir: '../outside' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/plansDir must not escape project root/);
  });

  // A config.json that already collides is reachable — boot only warns about it
  // (project-context.ts). If the guard fired on every PATCH, such a project could
  // never be repaired: even closing the onboarding wizard would 400.
  it('does not block an unrelated PATCH on a project whose dirs already collide', async () => {
    fs.writeFileSync(
      configPath(dir),
      JSON.stringify({ $schemaVersion: 4, name: 'test', briefsDir: 'same', patchesDir: 'same' }),
    );
    const res = await request(app()).patch('/config').send({ onboardingCompleted: true });
    expect(res.status).toBe(200);
  });

  it('still blocks a dir PATCH that would create the collision, normalizing the paths first', async () => {
    const res = await request(app()).patch('/config').send({ plansDir: './.claude4spec/briefs/' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/briefsDir and plansDir must differ/);
  });

  it('accepts a briefs/patches/plans triple moved together', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ briefsDir: 'spec/briefs', patchesDir: 'spec/patches', plansDir: 'spec/plans' });
    expect(res.status).toBe(200);
    expect((res.body as Config).plansDir).toBe('spec/plans');
  });
});

/**
 * D4 (0.2.9): write-target overlap is checked PAIRWISE and BIDIRECTIONALLY on the
 * post-merge effective state, and fires on any PATCH touching `roots[]` OR a storage
 * dir. The Settings payload is diff-only, so gating on `'roots' in body` (as before)
 * let a dir moved onto another write target through untouched.
 */
describe('PATCH /config — D4 write-target overlap (0.2.9)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-d4-'));
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 4, name: 'test' }));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const app = () => {
    const router = configRouter({ cwd: dir, skillRegistry: {} as unknown as SkillRegistry });
    return express().use(express.json()).use(router);
  };

  it('rejects entitiesDir moved onto releasesDir — neither side is a root, and no roots[] is sent', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ entitiesDir: '.claude4spec/releases' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    // Symmetric message — no "root '<id>' dir" framing, since no root is involved.
    expect(res.body.error.message).toMatch(
      /config\.json: '(entitiesDir|releasesDir)' overlaps write-target '(entitiesDir|releasesDir)'/,
    );
  });

  it('rejects entitiesDir moved onto the reserved .claude4spec/plugins target', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ entitiesDir: '.claude4spec/plugins' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/overlaps write-target/);
  });

  it('rejects entitiesDir moved onto an existing page root, with no roots[] in the body', async () => {
    const res = await request(app()).patch('/config').send({ entitiesDir: 'pages' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/overlaps write-target/);
  });

  it('warns but does NOT reject briefsDir overlapping a page root (rule 3a), without roots[]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await request(app()).patch('/config').send({ briefsDir: 'pages' });
      expect(res.status).toBe(200);
      expect((res.body as Config).briefsDir).toBe('pages');
      expect(warn.mock.calls.flat().join('\n')).toMatch(/overlaps briefsDir/);
    } finally {
      warn.mockRestore();
    }
  });

  it('leaves an unrelated PATCH alone even when the stored config already overlaps', async () => {
    fs.writeFileSync(
      configPath(dir),
      JSON.stringify({
        $schemaVersion: 4,
        name: 'test',
        entitiesDir: 'shared',
        releasesDir: 'shared',
      }),
    );
    // An already-broken project must stay repairable: only a PATCH that touches roots
    // or a storage dir is judged, so closing the onboarding wizard still works.
    const res = await request(app()).patch('/config').send({ onboardingCompleted: true });
    expect(res.status).toBe(200);
  });

  it('accepts a storage-dir PATCH that overlaps nothing', async () => {
    const res = await request(app()).patch('/config').send({ entitiesDir: 'spec/entities' });
    expect(res.status).toBe(200);
    expect((res.body as Config).entitiesDir).toBe('spec/entities');
  });

  it('does NOT reject a plansDir-only save because of a pre-existing entitiesDir collision', async () => {
    // Regression: gating the hard sweep on briefs/patches/plans meant a `{ plansDir }`
    // save could 400 with a message naming `entitiesDir` and a root — fields the request
    // never carried — and silently lose the edit. Those three fields only ever produce
    // rule-3a warnings, so they must not gate the hard check.
    fs.writeFileSync(
      configPath(dir),
      JSON.stringify({ $schemaVersion: 4, name: 'test', entitiesDir: 'pages' }),
    );
    const res = await request(app()).patch('/config').send({ plansDir: 'spec/plans' });
    expect(res.status).toBe(200);
    expect((res.body as Config).plansDir).toBe('spec/plans');
  });

  it('still rejects a PATCH that moves entitiesDir onto a root, even on a config already broken elsewhere', async () => {
    fs.writeFileSync(
      configPath(dir),
      JSON.stringify({ $schemaVersion: 4, name: 'test', releasesDir: 'shared', entitiesDir: 'shared' }),
    );
    const res = await request(app()).patch('/config').send({ entitiesDir: 'pages' });
    expect(res.status).toBe(400);
  });

  it('uses the running context roots (--pages override) rather than the ones on disk', async () => {
    // Without this the route validates against config.json's 'pages' while boot uses the
    // override, so it can bless an entitiesDir the next startup refuses to open.
    const router = configRouter({
      cwd: dir,
      skillRegistry: {} as unknown as SkillRegistry,
      effectiveRoots: [
        { id: 'pages', name: 'Pages', dir: 'docs', builtin: true, releasable: true, sectionIndexed: true, referenceValidated: true, linkTargets: [], sidebar: 'accordion', briefTarget: true },
      ],
    });
    const overridden = express().use(express.json()).use(router);
    const res = await request(overridden).patch('/config').send({ entitiesDir: 'docs/entities' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/overlaps write-target/);
  });
});


/**
 * 0.2.57 — `GET /writing-styles`, which had no test at all until the style it
 * serves moved out of the host.
 *
 * The whole point of the route here is the `source` field: it is the only place
 * a user can see WHERE a style comes from, and after this release the reference
 * style comes from an envelope rather than from the bundled root. Driven through
 * the real loader against the real `plugins/` tree — a stubbed registry would
 * assert that the route copies a field, which was never in doubt.
 */
describe('GET /writing-styles — where a style comes from (0.2.57)', () => {
  const STYLE = 'layered-vertical-slices';
  let dir: string;
  let skillRegistry: SkillRegistry;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-writing-styles-'));
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 3, writingStyle: STYLE }));

    const { PluginRegistryImpl } = await import('../core/plugin-host/registry.js');
    const { loadBuiltinEnvelopes } = await import('../core/plugin-host/loader.js');
    const { SkillRegistry, findSkillsRoots } = await import('../services/skill-registry.js');
    const plugins = new PluginRegistryImpl();
    await loadBuiltinEnvelopes(plugins);
    skillRegistry = SkillRegistry.load(findSkillsRoots(dir));
    for (const skill of plugins.listSkills()) skillRegistry.addPluginSkill(skill);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const app = () => express().use(express.json()).use(configRouter({ cwd: dir, skillRegistry }));

  it('[ac:ac-styl-layered-vertical-slices-wraca-z] reports the reference style as source "plugin", not "bundled"', async () => {
    const res = await request(app()).get('/writing-styles');
    expect(res.status).toBe(200);
    const entry = (res.body.available as Array<{ slug: string; source: string }>).find(
      (s) => s.slug === STYLE,
    );
    expect(entry, `${STYLE} is not selectable at all`).toBeDefined();
    expect(entry!.source).toBe('plugin');
  });

  /**
   * The bundled root stays in the precedence chain and the class stays legal for
   * styles — it is simply empty of them now. Asserting "no bundled style" rather
   * than "the root is gone" is the difference between the two.
   */
  it('offers no bundled style any more, the root having been emptied of them', async () => {
    const res = await request(app()).get('/writing-styles');
    const sources = (res.body.available as Array<{ source: string }>).map((s) => s.source);
    expect(sources).not.toContain('bundled');
    expect(res.body.active).toBe(STYLE);
  });
});
