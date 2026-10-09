import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { configPath, loadOrCreateConfig, type Config } from '../config.js';
import { resolveAgentPathScope } from '../services/agent-path-scope.js';
import { RootRegistry } from '../roots/registry.js';
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

  it('0.2.112: GET /config reports agent.claudeUsePreset false when the field is absent', async () => {
    const res = await request(app()).get('/config');
    expect(res.status).toBe(200);
    expect(res.body.agent.claudeUsePreset).toBe(false);
  });

  it('[ac:ac-continue-z-agent-conversationallangua] 0.2.112: onboarding [Continue] PATCH { agent: { conversationalLanguage } } keeps an explicit true', async () => {
    await request(app()).patch('/config').send({ agent: { claudeUsePreset: true } });
    const res = await request(app()).patch('/config').send({ agent: { conversationalLanguage: 'Polski' } });
    expect(res.status).toBe(200);
    expect(res.body.agent.claudeUsePreset).toBe(true);
    expect(res.body.agent.conversationalLanguage).toBe('Polski');
  });

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

// 2.1.8: the artifact directory keys (`plansDir`, `briefsDir`, `patchesDir`,
// `entitiesDir`, `releasesDir`) are gone from the API — the system roots live at
// fixed `.claude4spec/<kind>` dirs registered in code. `roots[]` entries carry
// exactly four fields.
describe('GET/PATCH /config — one root registry with kinds (2.1.8)', () => {
  let dir: string;
  const DIR_KEYS = ['plansDir', 'briefsDir', 'patchesDir', 'entitiesDir', 'releasesDir'];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-kinds-'));
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

  it('GET /config has none of the 5 dir keys and roots entries have exactly 4 fields', async () => {
    fs.writeFileSync(
      configPath(dir),
      JSON.stringify({
        $schemaVersion: 4,
        name: 'test',
        // Legacy keys and legacy per-root flags in the file are unknown fields.
        plansDir: '.claude4spec/plans',
        entitiesDir: '.claude4spec/entities',
        roots: [
          { id: 'pages', name: 'Pages', dir: 'pages', builtin: true, releasable: true, sidebar: 'accordion' },
          { id: 'docs', name: 'Docs', dir: 'docs', builtin: false, linkTargets: [] },
        ],
      }),
    );
    const res = await request(app()).get('/config');
    expect(res.status).toBe(200);
    for (const k of DIR_KEYS) expect(k in res.body).toBe(false);
    expect(res.body.roots).toEqual([
      { id: 'pages', name: 'Pages', dir: 'pages', builtin: true },
      { id: 'docs', name: 'Docs', dir: 'docs', builtin: false },
    ]);
    for (const r of res.body.roots) expect(Object.keys(r).sort()).toEqual(['builtin', 'dir', 'id', 'name']);
  });

  it('PATCH with roots missing builtin on an entry → 400', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }, { id: 'docs', name: 'Docs', dir: 'docs' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(/builtin/);
  });

  it('PATCH roots with id plans → 400', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }, { id: 'plans', name: 'Plans', dir: 'my-plans', builtin: false }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(/reserved for a system root/);
  });

  it('[ac:ac-zapis-konfiguracji-z-wpisem-roots-o-i] PATCH roots with id skills → 400 reserved identifier (M52: `skills` is the id of the code-source root of kind `skills`), config.json untouched', async () => {
    const before = fs.readFileSync(configPath(dir), 'utf8');
    const res = await request(app())
      .patch('/config')
      .send({ roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }, { id: 'skills', name: 'Skills', dir: 'my-skills', builtin: false }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(/root id 'skills' is reserved for a system root/);
    expect(fs.readFileSync(configPath(dir), 'utf8')).toBe(before);
  });

  it('PATCH carrying a legacy dir key ignores it — 200, nothing persisted', async () => {
    const res = await request(app()).patch('/config').send({ plansDir: '.claude4spec/roadmap', entitiesDir: 'pages' });
    expect(res.status).toBe(200);
    for (const k of DIR_KEYS) expect(k in res.body).toBe(false);
    const onDisk = JSON.parse(fs.readFileSync(configPath(dir), 'utf8')) as Record<string, unknown>;
    for (const k of DIR_KEYS) expect(k in onDisk).toBe(false);
  });

  it('PATCH roots strips unknown per-root fields before persisting', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true, releasable: false, foo: 1 }] });
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(fs.readFileSync(configPath(dir), 'utf8')) as Config;
    expect(onDisk.roots).toEqual([{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }]);
  });
});

/**
 * 2.1.8 (u11) — the wire shapes of `GET`/`PATCH /config` and the onboarding /
 * settings criteria that live on them.
 */
describe('GET/PATCH /config — wire shapes and the onboarding/settings criteria', () => {
  let dir: string;
  let rebuilds: number;
  let welcomes: string[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-wire-'));
    rebuilds = 0;
    welcomes = [];
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeFile = (cfg: Record<string, unknown>) => {
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg));
  };
  const onDisk = () => JSON.parse(fs.readFileSync(configPath(dir), 'utf8')) as Record<string, unknown>;
  const app = () => {
    const router = configRouter({
      cwd: dir,
      // `writingStyle: null` never consults the registry; a slug would.
      skillRegistry: { isSelectable: () => true, unselectableReason: () => '' } as unknown as SkillRegistry,
      onContextConfigChanged: () => {
        rebuilds++;
      },
      onOnboardingCompleted: (pagesDir) => {
        welcomes.push(pagesDir);
      },
      pluginSettingsSections: () => [
        { name: 'c4s-plugin-x', version: '1', fields: [{ key: 'flag', label: 'Flag', control: 'toggle', kind: 'hot-reload', default: false }] },
      ],
    });
    return express().use(express.json()).use(router);
  };
  const base = { id: 'pages', name: 'Pages', dir: 'pages', builtin: true };
  const adr = { id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false };

  it('[entity:app-config-response] GET /config carries the AppConfigResponse fields — and no system-root keys, no consistency', async () => {
    writeFile({
      $schemaVersion: 4,
      name: 'demo',
      description: 'pitch',
      roots: [base, adr],
      entities: ['endpoint'],
      consistency: { requireAcCoverage: 'warn' },
    });
    const res = await request(app()).get('/config');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.name).toBe('demo');
    expect(body.description).toBe('pitch');
    expect(body.roots).toEqual([base, adr]);
    expect(body.configHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.writingStyle).toBeNull();
    expect(body.writingStyleUnavailable).toBeNull();
    expect(body.language).toBeNull();
    expect(body.entities).toEqual(['endpoint']);
    expect(body.plugins).toEqual({});
    expect(body.agent).toMatchObject({
      claudeUsePreset: false,
      conversationalLanguage: null,
      allowedPaths: [],
      disallowedPaths: [],
      disableDirectFilesystemAccess: true,
      pathScopeStrength: 'none',
    });
    expect(body.remoteProjectId).toBeNull();
    expect(body.remoteApiUrl).toBeNull();
    expect(body.git).toEqual({
      enabled: false,
      syncPushOnPush: false,
      commitTarget: { mode: 'current', branch: null, template: null, base: null },
      switchAfterRelease: false,
    });
    expect(body.onboarding).toEqual({ completed: true });
    expect(body.$schemaVersion).toBe(4);
    for (const k of ['plansDir', 'briefsDir', 'patchesDir', 'entitiesDir', 'releasesDir', 'consistency']) {
      expect(k in body, k).toBe(false);
    }
  });

  it('[entity:patch-config-request] PATCH /config takes the PatchConfigRequest fields; system-root keys and response-only fields are dropped silently', async () => {
    writeFile({ $schemaVersion: 4, name: 'demo', roots: [base] });
    const res = await request(app())
      .patch('/config')
      .send({
        name: 'Renamed',
        description: 'short pitch',
        roots: [base, adr],
        entities: ['endpoint'],
        plugins: { 'c4s-plugin-x': { flag: true } },
        writingStyle: null,
        language: 'English',
        agent: { claudeUsePreset: true, conversationalLanguage: 'Polski', allowedPaths: ['/opt/x'], disallowedPaths: ['/opt/y'], disableDirectFilesystemAccess: false },
        git: { enabled: true },
        remoteProjectId: '11111111-2222-3333-4444-555555555555',
        onboardingCompleted: true,
        // Not writable here: fixed system roots, response-only fields.
        plansDir: 'docs/plans',
        releasesDir: 'rel',
        configHash: 'x',
        writingStyleUnavailable: { reason: 'x' },
      });
    expect(res.status).toBe(200);
    const file = onDisk();
    expect(file).toMatchObject({
      name: 'Renamed',
      description: 'short pitch',
      roots: [base, adr],
      entities: ['endpoint'],
      plugins: { 'c4s-plugin-x': { flag: true } },
      writingStyle: null,
      language: 'English',
      agent: { claudeUsePreset: true, conversationalLanguage: 'Polski', allowedPaths: ['/opt/x'], disallowedPaths: ['/opt/y'], disableDirectFilesystemAccess: false },
      git: { enabled: true },
      remoteProjectId: '11111111-2222-3333-4444-555555555555',
      onboardingCompleted: true,
    });
    for (const k of ['plansDir', 'releasesDir', 'configHash', 'writingStyleUnavailable']) expect(k in file, k).toBe(false);
    // A roots[] entry missing one of its four fields is refused.
    const partial = await request(app()).patch('/config').send({ roots: [{ id: 'pages', name: 'Pages', dir: 'pages' }] });
    expect(partial.status).toBe(400);
  });

  it('[ac:ac-odczyt-konfiguracji-po-swiezym-bootst] a read after a fresh bootstrap returns onboarding.completed === false', async () => {
    loadOrCreateConfig(dir, {});
    const res = await request(app()).get('/config');
    expect(res.status).toBe(200);
    expect(res.body.onboarding).toEqual({ completed: false });
  });

  it('[ac:ac-po-domknieciu-onboardingu-odczyt-konf] after onboarding closes, a read returns onboarding.completed === true', async () => {
    loadOrCreateConfig(dir, {});
    await request(app()).patch('/config').send({ onboardingCompleted: true }).expect(200);
    const res = await request(app()).get('/config');
    expect(res.body.onboarding).toEqual({ completed: true });
  });

  it('[ac:ac-projekt-sprzed-m16-ktorego-config-nie] a config file without onboardingCompleted reads as completed — no redirect to onboarding', async () => {
    writeFile({ $schemaVersion: 4, name: 'old', roots: [base] });
    const res = await request(app()).get('/config');
    expect(res.body.onboarding).toEqual({ completed: true });
    // The key is not written back by the read.
    expect('onboardingCompleted' in onDisk()).toBe(false);
  });

  it('[ac:ac-continue-z-waznym-formularzem-wysyla] the [Continue] body persists name, writingStyle, language, agent.conversationalLanguage, roots and onboardingCompleted in one write', async () => {
    loadOrCreateConfig(dir, {});
    const res = await request(app())
      .patch('/config')
      .send({
        name: 'My spec',
        writingStyle: null,
        language: 'English',
        agent: { conversationalLanguage: 'Polski' },
        roots: [{ ...base, dir: 'spec' }],
        onboardingCompleted: true,
      });
    expect(res.status).toBe(200);
    expect(onDisk()).toMatchObject({
      name: 'My spec',
      writingStyle: null,
      language: 'English',
      agent: { conversationalLanguage: 'Polski' },
      roots: [{ ...base, dir: 'spec' }],
      onboardingCompleted: true,
    });
    // The welcome step runs on the effective, post-write base root dir.
    expect(welcomes).toEqual(['spec']);
  });

  it('[ac:ac-continue-ze-zmienionym-dir-builtin-ro] a roots[] with only the builtin entry\'s dir swapped is persisted and rebuilds the ProjectContext; a body without roots does not', async () => {
    writeFile({ $schemaVersion: 4, name: 'demo', roots: [base, adr], onboardingCompleted: false });
    await request(app())
      .patch('/config')
      .send({ roots: [{ ...base, dir: 'spec' }, adr], onboardingCompleted: true })
      .expect(200);
    expect(onDisk().roots).toEqual([{ ...base, dir: 'spec' }, adr]);
    expect(rebuilds).toBe(1);

    await request(app()).patch('/config').send({ name: 'n', onboardingCompleted: true }).expect(200);
    expect(rebuilds).toBe(1);
  });

  it('[ac:ac-skip-nie-wysyla-roots-dir-builtin-roo] the [Skip] body leaves the base root at its bootstrap dir and identifier, with no rename recorded', async () => {
    loadOrCreateConfig(dir, {});
    await request(app()).patch('/config').send({ onboardingCompleted: true }).expect(200);
    expect(onDisk().roots).toEqual([base]);
    expect(fs.existsSync(path.join(dir, '.claude4spec', 'root-renames.json'))).toBe(false);
    expect(rebuilds).toBe(0);
  });

  it('[ac:ac-skip-otwiera-confirmmodal-a-po-potwie] the [Skip] body ({ onboardingCompleted: true } alone) leaves both languages null', async () => {
    loadOrCreateConfig(dir, {});
    const res = await request(app()).patch('/config').send({ onboardingCompleted: true });
    expect(res.status).toBe(200);
    expect(res.body.language).toBeNull();
    expect(res.body.agent.conversationalLanguage).toBeNull();
    expect(res.body.onboarding).toEqual({ completed: true });
  });

  it('[ac:ac-m26-sekcja-agent-settings-zawiera-d] PATCH { agent: { conversationalLanguage } } deep-merges — the other agent fields survive — and a language off the list is a 400 on that field', async () => {
    writeFile({
      $schemaVersion: 4,
      name: 'demo',
      roots: [base],
      agent: { claudeUsePreset: true, allowedPaths: ['/opt/a'], disallowedPaths: ['/opt/b'], disableDirectFilesystemAccess: false },
    });
    const res = await request(app()).patch('/config').send({ agent: { conversationalLanguage: 'Deutsch' } });
    expect(res.status).toBe(200);
    expect(onDisk().agent).toEqual({
      claudeUsePreset: true,
      allowedPaths: ['/opt/a'],
      disallowedPaths: ['/opt/b'],
      disableDirectFilesystemAccess: false,
      conversationalLanguage: 'Deutsch',
    });

    const bad = await request(app()).patch('/config').send({ agent: { conversationalLanguage: 'Klingon' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION');
    expect(bad.body.error.details.field).toMatch(/conversationalLanguage/);
    expect((onDisk().agent as Record<string, unknown>).conversationalLanguage).toBe('Deutsch');
  });

  it('[ac:ac-m26-sekcja-project-settings-zawiera-2] PATCH { language } persists a listed language or null; one off the list is a 400 on `language`', async () => {
    writeFile({ $schemaVersion: 4, name: 'demo', roots: [base] });
    await request(app()).patch('/config').send({ language: 'Français' }).expect(200);
    expect(onDisk().language).toBe('Français');
    await request(app()).patch('/config').send({ language: null }).expect(200);
    expect(onDisk().language).toBeNull();
    const bad = await request(app()).patch('/config').send({ language: 'Klingon' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.field).toBe('language');
    expect(onDisk().language).toBeNull();
  });

  it('[ac:ac-textarea-allowed-disallowed-paths-sekcj] saving the parsed path list deep-merges onto agent: the array replaces, the other fields stay', async () => {
    writeFile({
      $schemaVersion: 4,
      name: 'demo',
      roots: [base],
      agent: { allowedPaths: ['/old'], disallowedPaths: ['/keep'], disableDirectFilesystemAccess: false },
    });
    const res = await request(app()).patch('/config').send({ agent: { allowedPaths: ['/a', '/b'] } });
    expect(res.status).toBe(200);
    expect(res.body.agent.allowedPaths).toEqual(['/a', '/b']);
    expect(res.body.agent.disallowedPaths).toEqual(['/keep']);
    expect(res.body.agent.disableDirectFilesystemAccess).toBe(false);
  });

  it('[ac:ac-pola-agent-allowedpaths-agent-disallowed] the path lists are additive — absent reads as [], no $schemaVersion bump, and [] keeps the agent in the implicit base', async () => {
    writeFile({ $schemaVersion: 4, name: 'demo', roots: [base] });
    const res = await request(app()).get('/config');
    expect(res.body.agent.allowedPaths).toEqual([]);
    expect(res.body.agent.disallowedPaths).toEqual([]);
    expect(res.body.agent.pathScopeStrength).toBe('none');

    await request(app()).patch('/config').send({ agent: { allowedPaths: ['/opt/x'] } }).expect(200);
    expect(onDisk().$schemaVersion).toBe(4);

    // Empty lists: nothing beyond the implicit base (cwd + page roots, none outside cwd here),
    // and nothing denied but the always-excluded system roots.
    const scope = resolveAgentPathScope({ cwd: dir, roots: new RootRegistry([base]).list(), allowedPaths: [], disallowedPaths: [] });
    expect(scope.allowedPaths).toEqual([]);
    expect(scope.disallowedPaths.every((p) => p.startsWith(path.join(dir, '.claude4spec')))).toBe(true);
  });
});

/**
 * D4 (2.1.8): overlap is computed on NAMESPACES of each user root vs the other
 * user roots, the 5 system roots and `.claude4spec/plugins`. Only a PATCH that
 * carries `roots` can introduce an overlap, so only such a PATCH is judged.
 */
describe('PATCH /config — D4 root namespace overlap (2.1.8)', () => {
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
  const base = { id: 'pages', name: 'Pages', dir: 'pages', builtin: true };

  it('rejects a root moved onto a system root dir', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ roots: [base, { id: 'rel', name: 'Rel', dir: '.claude4spec/releases', builtin: false }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toBe("config.json: 'rel' overlaps write-target 'releases'");
  });

  it('rejects a root under a system root dir', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ roots: [base, { id: 'x', name: 'X', dir: '.claude4spec/plans/x', builtin: false }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/overlaps write-target 'plans'/);
  });

  it('rejects a root moved onto the reserved .claude4spec/plugins target', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ roots: [base, { id: 'gen', name: 'Gen', dir: '.claude4spec/plugins', builtin: false }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/overlaps write-target/);
  });

  it('rejects two user roots on overlapping dirs', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ roots: [base, { id: 'sub', name: 'Sub', dir: 'pages/sub', builtin: false }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/overlaps write-target/);
  });

  it('accepts a base root at "."', async () => {
    const res = await request(app()).patch('/config').send({ roots: [{ ...base, dir: '.' }] });
    expect(res.status).toBe(200);
    expect((res.body as Config).roots[0]!.dir).toBe('.');
  });

  it('leaves an unrelated PATCH alone even when the stored config already overlaps', async () => {
    fs.writeFileSync(
      configPath(dir),
      JSON.stringify({
        $schemaVersion: 4,
        name: 'test',
        roots: [base, { id: 'ent', name: 'Ent', dir: '.claude4spec/entities', builtin: false }],
      }),
    );
    // An already-broken project must stay repairable: only a PATCH that carries
    // roots is judged, so closing the onboarding wizard still works.
    const res = await request(app()).patch('/config').send({ onboardingCompleted: true });
    expect(res.status).toBe(200);
  });
});


/**
 * 0.2.57 — `GET /writing-styles`, which had no test at all until the style it
 * serves moved out of the host.
 *
 * The whole point of the route here is the `source` field: it is the only place
 * a user can see WHERE a style comes from, and after this release the reference
 * style comes from an envelope rather than from the in-package root. Driven through
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

  it('[ac:ac-styl-layered-vertical-slices-wraca-z] reports the reference style as source "plugin"', async () => {
    const res = await request(app()).get('/writing-styles');
    expect(res.status).toBe(200);
    const entry = (res.body.available as Array<{ slug: string; source: string }>).find(
      (s) => s.slug === STYLE,
    );
    expect(entry, `${STYLE} is not selectable at all`).toBeDefined();
    expect(entry!.source).toBe('plugin');
  });

  /**
   * 0.2.57 emptied the in-package root of styles and this assertion said so; 0.2.66
   * deleted the root and the `'bundled'` class outright, so the claim is no longer
   * "nothing lives there" but "there are two sources a style can have". Asserted as
   * a CLOSED SET rather than as the absence of one literal: what the DTO promises
   * its consumers is that `source` is one of exactly two values, and a third
   * appearing is the regression, whatever it is called.
   */
  it('serves every style with a source from the registry\'s set — the bundled class is gone', async () => {
    // 2.1.9: the set is the registry's `SkillSource` (project-rooted and
    // project-exposed joined it); the all-sources rig is writing-styles.route.test.ts.
    const { SKILL_SOURCES } = await import('../../shared/writing-styles.js');
    const res = await request(app()).get('/writing-styles');
    const sources = (res.body.available as Array<{ source: string }>).map((s) => s.source);
    expect(sources.length).toBeGreaterThan(0);
    expect([...new Set(sources)].filter((x) => !(SKILL_SOURCES as readonly string[]).includes(x))).toEqual([]);
    expect(sources).not.toContain('bundled');
    expect(res.body.active).toBe(STYLE);
  });
});
