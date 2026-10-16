import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { readConfig, writeConfig, type SkillConfig } from '../config.js';
import { registerCoreOperations } from '../operations/core-operations.js';
import { expectOperationMatchesRecord } from '../../../tests/helpers/operation-records.js';
import { listExposedProjectRows, listExposedProjects } from '../services/exposed-projects.js';
import { specSkillsRouter } from './spec-skills.js';

/**
 * 2.1.9 — M52 L4: `GET /api/spec-skills/exposed-projects` (endpoint
 * `get-api-spec-skills-exposed-projects`, DTO `exposed-project-row`), the `rest`
 * rendering of `list_exposed_projects` (sheet `katalog-operacji-m52`, row 4).
 *
 * The rig is a workspace of real project directories with real `config.json`
 * files; the route is bound to the current project exactly as the project
 * context binds it (its id, its `skill.uses` read per call, the workspace's
 * exposed projects read per call).
 */

registerCoreOperations();

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function project(name: string, skill: SkillConfig): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-spec-skills-route-'));
  tmpDirs.push(cwd);
  writeConfig(cwd, { name, skill });
  return cwd;
}

/** A workspace: `shop` (current) attaches `billing-rules`, `ghost` (dangling) and `docs` (ambiguous). */
function workspace() {
  const projects = [
    { id: 'shop', cwd: project('Shop', { exposed: true, name: 'shop-skill', description: 'The shop.', uses: ['billing-rules', 'ghost', 'docs', 'shop-skill'] }) },
    { id: 'billing', cwd: project('Billing', { exposed: true, name: 'billing-rules', description: 'How billing works.' }) },
    { id: 'docs-a', cwd: project('Docs A', { exposed: true, name: 'docs', description: 'Docs A.' }) },
    { id: 'docs-b', cwd: project('Docs B', { exposed: true, name: 'docs', description: 'Docs B.' }) },
    { id: 'legal', cwd: project('Legal', { exposed: true, name: 'legal-terms', description: 'Terms.' }) },
    { id: 'hidden', cwd: project('Hidden', { exposed: false, name: 'hidden-skill', description: 'Not exposed.' }) },
  ];
  const shop = projects[0]!.cwd;
  const app = express().use(
    '/api/spec-skills',
    specSkillsRouter({
      listExposedProjects: () =>
        listExposedProjectRows('shop', readConfig(shop).skill?.uses ?? [], listExposedProjects(projects)),
    }),
  );
  return { app, shop, projects };
}

describe('GET /api/spec-skills/exposed-projects (M52 L4, 2.1.9)', () => {
  it('[entity:get-api-spec-skills-exposed-projects] GET answers 200 { data: rows } — every exposed project of the workspace and every attachment of the current project, dangling included; read-only', async () => {
    const { app, shop } = workspace();
    const before = fs.readFileSync(path.join(shop, '.claude4spec', 'config.json'), 'utf8');
    const res = await request(app).get('/api/spec-skills/exposed-projects');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect((res.body.data as Array<{ name: string }>).map((r) => r.name)).toEqual(['billing-rules', 'docs', 'ghost', 'legal-terms']);
    // Read-only: the current project's config is untouched.
    expect(fs.readFileSync(path.join(shop, '.claude4spec', 'config.json'), 'utf8')).toBe(before);
    // No other verb on the route.
    expect((await request(app).post('/api/spec-skills/exposed-projects').send({})).status).toBe(404);
  });

  it('[entity:exposed-project-row] each row carries name, description?, projectId?, uses and status (ok | unavailable | ambiguous)', async () => {
    const { app } = workspace();
    const res = await request(app).get('/api/spec-skills/exposed-projects');
    expect(res.body.data).toEqual([
      { name: 'billing-rules', description: 'How billing works.', projectId: 'billing', uses: true, status: 'ok' },
      // Ambiguous: two projects expose `docs` — no projectId, no description.
      { name: 'docs', uses: true, status: 'ambiguous' },
      // Dangling: nobody exposes `ghost` — the name written in skill.uses, no description, no projectId.
      { name: 'ghost', uses: true, status: 'unavailable' },
      { name: 'legal-terms', description: 'Terms.', projectId: 'legal', uses: false, status: 'ok' },
    ]);
    for (const row of res.body.data as Array<Record<string, unknown>>) {
      expect(Object.keys(row).every((k) => ['name', 'description', 'projectId', 'uses', 'status'].includes(k))).toBe(true);
      expect(typeof row.name).toBe('string');
      expect(typeof row.uses).toBe('boolean');
      expect(['ok', 'unavailable', 'ambiguous']).toContain(row.status);
    }
    // The current project never has a row — not even by its own name sitting in its `uses`.
    expect(JSON.stringify(res.body.data)).not.toContain('shop');
  });

  it('[ac:m52-dangling-attachment-marked-unavailable] a dangling attachment comes back with status `unavailable` — the #skills card marks it Unavailable', async () => {
    const { app, projects } = workspace();
    const ghost = (await request(app).get('/api/spec-skills/exposed-projects')).body.data.find((r: { name: string }) => r.name === 'ghost');
    expect(ghost).toEqual({ name: 'ghost', uses: true, status: 'unavailable' });
    // The provider of `billing-rules` stops exposing itself: that attachment is dangling now, too.
    writeConfig(projects[1]!.cwd, { skill: { exposed: false } });
    const billing = (await request(app).get('/api/spec-skills/exposed-projects')).body.data.find(
      (r: { name: string }) => r.name === 'billing-rules',
    );
    expect(billing).toEqual({ name: 'billing-rules', uses: true, status: 'unavailable' });
  });

  /**
   * 2.1.26 — the M52 page embeds the `spec-operation` records instead of the
   * `katalog-operacji-m52` sheet, so the row is held against its record
   * `list-exposed-projects`.
   */
  it('[entity:list-exposed-projects] list_exposed_projects: workspace, direct, internal/cli/mcp n/a with the record\'s reason, rest direct, no effects, idempotent, no codes, no renderings, addressed by the current project — and its rest rendering answers the same twice', async () => {
    const CARD_ONLY = 'zasila wyłącznie kartę ustawień';
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'list_exposed_projects',
        zasieg: 'workspace',
        channels: {
          internal: { kind: 'na', reason: CARD_ONLY },
          cli: { kind: 'na', reason: CARD_ONLY },
          mcp: { kind: 'na', reason: CARD_ONLY },
          rest: { kind: 'direct' },
        },
        efekty: ['none'],
        idempotencja: true,
        opisTresci: undefined,
        kodyBledow: [],
        narzedzia: {},
      },
      {},
    );
    expect(op.opClass).toBe('read');
    // Addressed by the current project (its attachments), not by an argument; no paging.
    expect(op.inputSchema).toEqual({});
    // Observable: the read has no guard — it answers, and answers the same twice.
    const { app } = workspace();
    const a = await request(app).get('/api/spec-skills/exposed-projects');
    const b = await request(app).get('/api/spec-skills/exposed-projects');
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
  });
});

/**
 * 2.1.9 — M52 L4: `POST /api/spec-skills/style-forks` (endpoint
 * `post-api-spec-skills-style-forks`, DTOs `fork-writing-style-request` /
 * `fork-writing-style-response`), the `rest` rendering of `fork_writing_style`
 * (sheet `katalog-operacji-m52`, row 3).
 *
 * The rig is a project as `project-context.ts` builds it: the registry roots
 * mounted (the `skills` root with its facade), the project registry with the
 * `.claude/skills` root, the `project-rooted` source and the builtin envelopes
 * pushed by the real loader — the reference style `layered-vertical-slices`
 * comes from a plugin, with its `workflows/` and `templates/` files.
 */
describe('POST /api/spec-skills/style-forks (M52 L4, 2.1.9)', () => {
  const PLUGIN_STYLE = 'layered-vertical-slices';
  const INACTIVE_PLUGIN_STYLE = 'plain-notes';

  async function forkRig() {
    const { FileWatchRuntime } = await import('../fs/watcher.js');
    const { RootRegistry } = await import('../roots/registry.js');
    const { registerCoreReactions } = await import('../workspace/core-reactions.js');
    const { mountRegistryRoots } = await import('../workspace/root-registry-runtime.js');
    const { SkillRegistry } = await import('../services/skill-registry.js');
    const { registerProjectRootedSkills } = await import('../services/project-rooted-skills.js');
    const { forkWritingStyle } = await import('../services/style-fork.js');
    const { PluginRegistryImpl } = await import('../core/plugin-host/registry.js');
    const { loadBuiltinEnvelopes } = await import('../core/plugin-host/loader.js');
    const { configRouter } = await import('./config.js');
    registerCoreReactions();

    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-style-forks-'));
    tmpDirs.push(cwd);
    writeConfig(cwd, { name: 'Shop', writingStyle: PLUGIN_STYLE });
    const userRoots = [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }];
    const runtime = new FileWatchRuntime({ fsEvents: false });
    const roots = new RootRegistry(userRoots);
    const mounted = await mountRegistryRoots({ cwd, registry: roots, userRoots, w: runtime.scoped('context:style-forks#1') });
    const skills = mounted.rootRuntimes.find((rt) => rt.root.id === 'skills');
    expect(skills, 'the skills root has a facade').toBeDefined();
    const registry = SkillRegistry.load([{ dir: path.join(cwd, '.claude', 'skills'), source: 'user', registration: 'user-project' }], {
      rescanTtlMs: 0,
    });
    registerProjectRootedSkills(registry, roots, cwd);
    const plugins = new PluginRegistryImpl();
    await loadBuiltinEnvelopes(plugins);
    for (const skill of plugins.listSkills()) registry.addPluginSkill(skill);
    // 2.1.17 — a second writing style from a plugin, NOT the active one
    // (`config.writingStyle` is the reference style).
    registry.addPluginStyle({
      slug: INACTIVE_PLUGIN_STYLE,
      title: 'Plain Notes',
      description: 'A plugin style no project setting points at.',
      version: 1,
      language: 'en',
      content: '# Plain Notes\n\nWrite plainly.\n',
      files: { 'templates/note.md': '# Note\n' },
    });

    const app = express()
      .use(
        '/api/spec-skills',
        specSkillsRouter({
          listExposedProjects: () => [],
          forkWritingStyle: (input) => forkWritingStyle({ registry, skillsRoot: () => ({ pages: skills!.pages }) }, input),
        }),
      )
      .use('/api', express.json(), configRouter({ cwd, skillRegistry: registry }));
    const skillsDir = path.join(cwd, '.claude4spec', 'skills');
    const configBytes = () => fs.readFileSync(path.join(cwd, '.claude4spec', 'config.json'), 'utf8');
    const frontmatterOf = async (slug: string) => {
      const matter = (await import('gray-matter')).default;
      return matter(fs.readFileSync(path.join(skillsDir, slug, 'SKILL.md'), 'utf8'), {}).data as Record<string, unknown>;
    };
    return { cwd, app, registry, skillsDir, configBytes, frontmatterOf, close: () => runtime.close() };
  }

  it('[entity:post-api-spec-skills-style-forks] POST answers 201 with the copy\'s address and writes the plugin style\'s package into the skills root — for any plugin style, the slug is not compared with config.writingStyle; refuses a taken slug (409 SKILL_ALREADY_EXISTS), an unknown style (404 SKILL_NOT_FOUND) and a style that does not come from a plugin (400 INVALID_ARGUMENT)', async () => {
    const r = await forkRig();
    try {
      const plugin = r.registry.resolve(PLUGIN_STYLE);
      const res = await request(r.app).post('/api/spec-skills/style-forks').send({ slug: PLUGIN_STYLE });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ slug: PLUGIN_STYLE, path: `${PLUGIN_STYLE}/SKILL.md` });
      // The whole package: SKILL.md plus every file the plugin carries.
      expect(fs.existsSync(path.join(r.skillsDir, PLUGIN_STYLE, 'SKILL.md'))).toBe(true);
      const fileNames = Object.keys(plugin.files);
      expect(fileNames.length).toBeGreaterThan(0);
      for (const f of fileNames) {
        expect(fs.readFileSync(path.join(r.skillsDir, PLUGIN_STYLE, f), 'utf8'), f).toBe(plugin.files[f]!.content);
      }

      const again = await request(r.app).post('/api/spec-skills/style-forks').send({ slug: PLUGIN_STYLE });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('SKILL_ALREADY_EXISTS');

      const unknown = await request(r.app).post('/api/spec-skills/style-forks').send({ slug: 'no-such-style' });
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('SKILL_NOT_FOUND');

      // A style of the `.claude/skills` root is not a plugin's.
      const userStyle = path.join(r.cwd, '.claude', 'skills', 'team-voice');
      fs.mkdirSync(userStyle, { recursive: true });
      fs.writeFileSync(
        path.join(userStyle, 'SKILL.md'),
        ['---', 'title: Team Voice', 'description: Ours.', 'version: 1', 'language: en', '---', '', '# Team Voice', ''].join('\n'),
      );
      const notPlugin = await request(r.app).post('/api/spec-skills/style-forks').send({ slug: 'team-voice' });
      expect(notPlugin.status).toBe(400);
      expect(notPlugin.body.error.code).toBe('INVALID_ARGUMENT');
      expect(fs.existsSync(path.join(r.skillsDir, 'team-voice'))).toBe(false);

      // A plugin style other than the active one is copied too (2.1.17).
      const other = await request(r.app).post('/api/spec-skills/style-forks').send({ slug: INACTIVE_PLUGIN_STYLE });
      expect(other.status).toBe(201);
      expect(other.body).toEqual({ slug: INACTIVE_PLUGIN_STYLE, path: `${INACTIVE_PLUGIN_STYLE}/SKILL.md` });

      // POST only.
      expect((await request(r.app).get('/api/spec-skills/style-forks')).status).toBe(404);
    } finally {
      await r.close();
    }
  });

  it('[entity:fork-writing-style-request] the body carries `slug`, the plugin style to copy — not necessarily config.writingStyle; the local package gets that very slug; a body without it is a 400', async () => {
    const r = await forkRig();
    try {
      const missing = await request(r.app).post('/api/spec-skills/style-forks').send({});
      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe('INVALID_ARGUMENT');
      const res = await request(r.app).post('/api/spec-skills/style-forks').send({ slug: PLUGIN_STYLE });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe(PLUGIN_STYLE);
      expect(fs.existsSync(path.join(r.skillsDir, PLUGIN_STYLE, 'SKILL.md'))).toBe(true);
      // `slug` need not equal config.writingStyle.
      expect(readConfig(r.cwd).writingStyle).not.toBe(INACTIVE_PLUGIN_STYLE);
      const other = await request(r.app).post('/api/spec-skills/style-forks').send({ slug: INACTIVE_PLUGIN_STYLE });
      expect(other.status).toBe(201);
      expect(other.body.slug).toBe(INACTIVE_PLUGIN_STYLE);
      expect(fs.existsSync(path.join(r.skillsDir, INACTIVE_PLUGIN_STYLE, 'SKILL.md'))).toBe(true);
    } finally {
      await r.close();
    }
  });

  it('[entity:fork-writing-style-response] the 201 body is exactly { slug, path } — the created package\'s slug and its SKILL.md path relative to the skills root; no content', async () => {
    const r = await forkRig();
    try {
      const res = await request(r.app).post('/api/spec-skills/style-forks').send({ slug: PLUGIN_STYLE });
      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(['path', 'slug']);
      expect(res.body.slug).toBe(PLUGIN_STYLE);
      expect(res.body.path).toBe(`${PLUGIN_STYLE}/SKILL.md`);
      expect(fs.existsSync(path.join(r.skillsDir, res.body.path as string))).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('Layered Vertical Slices');
    } finally {
      await r.close();
    }
  });

  /**
   * 2.1.26 — held against the `spec-operation` record `fork-writing-style` (the
   * M52 page no longer embeds the `katalog-operacji-m52` sheet).
   */
  it('[entity:fork-writing-style] fork_writing_style: project, human-mediated, internal/cli/mcp n/a with the record\'s reason, rest direct, file + ui-notify effects, not idempotent, no content input, codes SKILL_NOT_FOUND, SKILL_ALREADY_EXISTS, INVALID_ARGUMENT, no renderings, addressed by the slug of any plugin style — an existing package of the slug is refused, never overwritten, and a style not from a plugin is INVALID_ARGUMENT', async () => {
    const SETTINGS_CARD = 'akcja karty ustawień';
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'fork_writing_style',
        mediacja: 'human-mediated',
        channels: {
          internal: { kind: 'na', reason: SETTINGS_CARD },
          cli: { kind: 'na', reason: SETTINGS_CARD },
          mcp: { kind: 'na', reason: SETTINGS_CARD },
          rest: { kind: 'direct' },
        },
        efekty: ['file', 'ui-notify'],
        idempotencja: false,
        opisTresci: 'n/a',
        kodyBledow: ['SKILL_NOT_FOUND', 'SKILL_ALREADY_EXISTS', 'INVALID_ARGUMENT'],
        narzedzia: {},
      },
      {},
    );
    expect(op.opClass).toBe('write');
    expect(Object.keys(op.inputSchema)).toEqual(['slug']);
    // Addressing: the slug of a plugin writing style — any, not only the active one.
    expect(op.summary).toContain('not only the active one');
    expect(op.summary).toContain('not compared with `config.writingStyle`');

    const r = await forkRig();
    try {
      // A package of that slug already lies in the skills root (even an invalid one).
      const own = path.join(r.skillsDir, PLUGIN_STYLE);
      fs.mkdirSync(own, { recursive: true });
      fs.writeFileSync(path.join(own, 'notes.md'), 'mine\n');
      const res = await request(r.app).post('/api/spec-skills/style-forks').send({ slug: PLUGIN_STYLE });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SKILL_ALREADY_EXISTS');
      expect(fs.readdirSync(own)).toEqual(['notes.md']);
      expect(fs.readFileSync(path.join(own, 'notes.md'), 'utf8')).toBe('mine\n');

      // The record's `zachowanie`: a style that does not come from a plugin is INVALID_ARGUMENT.
      const userStyle = path.join(r.cwd, '.claude', 'skills', 'house-voice');
      fs.mkdirSync(userStyle, { recursive: true });
      fs.writeFileSync(
        path.join(userStyle, 'SKILL.md'),
        ['---', 'title: House Voice', 'description: Ours.', 'version: 1', 'language: en', '---', '', '# House Voice', ''].join('\n'),
      );
      const notPlugin = await request(r.app).post('/api/spec-skills/style-forks').send({ slug: 'house-voice' });
      expect(notPlugin.status).toBe(400);
      expect(notPlugin.body.error.code).toBe('INVALID_ARGUMENT');
      expect(fs.existsSync(path.join(r.skillsDir, 'house-voice'))).toBe(false);
    } finally {
      await r.close();
    }
  });

  it('[ac:m52-style-fork-keeps-writing-style-config] the fork leaves config.writingStyle unchanged — the active style now resolves to the local copy, which records its origin in forkedFrom', async () => {
    const r = await forkRig();
    try {
      const before = r.configBytes();
      expect((await request(r.app).get('/api/writing-styles')).body.available.find((s: { slug: string }) => s.slug === PLUGIN_STYLE).source).toBe(
        'plugin',
      );
      const res = await request(r.app).post('/api/spec-skills/style-forks').send({ slug: PLUGIN_STYLE });
      expect(res.status).toBe(201);
      expect(r.configBytes()).toBe(before);
      expect(readConfig(r.cwd).writingStyle).toBe(PLUGIN_STYLE);
      const styles = (await request(r.app).get('/api/writing-styles')).body;
      expect(styles.active).toBe(PLUGIN_STYLE);
      expect(styles.available.find((s: { slug: string }) => s.slug === PLUGIN_STYLE).source).toBe('project-rooted');
      const matter = (await import('gray-matter')).default;
      const data = matter(fs.readFileSync(path.join(r.skillsDir, PLUGIN_STYLE, 'SKILL.md'), 'utf8'), {}).data;
      expect(data).toMatchObject({ scope: 'writing-style', title: 'Layered Vertical Slices' });
      expect(String(data.forkedFrom)).toContain(PLUGIN_STYLE);
      // A header the skills root reads (the disk sources skip a version above the supported one).
      const { SUPPORTED_SKILL_VERSION } = await import('../services/skill-registry.js');
      expect(data.version).toBeLessThanOrEqual(SUPPORTED_SKILL_VERSION);
    } finally {
      await r.close();
    }
  });

  it('[ac:m52-style-fork-accepts-inactive-plugin-style] forking a plugin writing style whose slug differs from config.writingStyle creates a local package of that slug, and switches nothing', async () => {
    const r = await forkRig();
    try {
      const before = r.configBytes();
      expect(readConfig(r.cwd).writingStyle).toBe(PLUGIN_STYLE);
      expect(r.registry.winnerOf(INACTIVE_PLUGIN_STYLE)?.source).toBe('plugin');

      const res = await request(r.app).post('/api/spec-skills/style-forks').send({ slug: INACTIVE_PLUGIN_STYLE });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ slug: INACTIVE_PLUGIN_STYLE, path: `${INACTIVE_PLUGIN_STYLE}/SKILL.md` });
      // The local package of that very slug: SKILL.md and the style's files.
      expect(fs.existsSync(path.join(r.skillsDir, INACTIVE_PLUGIN_STYLE, 'SKILL.md'))).toBe(true);
      expect(fs.readFileSync(path.join(r.skillsDir, INACTIVE_PLUGIN_STYLE, 'templates', 'note.md'), 'utf8')).toBe('# Note\n');
      // A valid package: the registry now resolves the slug to the local copy.
      expect(r.registry.winnerOf(INACTIVE_PLUGIN_STYLE)?.source).toBe('project-rooted');
      // Nothing switched: the config is byte-identical, the active style is still the other one.
      expect(r.configBytes()).toBe(before);
      expect((await request(r.app).get('/api/writing-styles')).body.active).toBe(PLUGIN_STYLE);
      // No package of the active style was made.
      expect(fs.existsSync(path.join(r.skillsDir, PLUGIN_STYLE))).toBe(false);
    } finally {
      await r.close();
    }
  });

  it('[ac:m52-style-fork-clamps-unsupported-version] after forking a plugin style whose version is above the supported one, load_skill_file for its slug serves the copy from the project-rooted source', async () => {
    const { SUPPORTED_SKILL_VERSION } = await import('../services/skill-registry.js');
    const { loadSkillFile } = await import('../services/skill-operations.js');
    const r = await forkRig();
    try {
      // The reference style carries a version the disk sources would skip.
      const pluginVersion = r.registry.winnerOf(PLUGIN_STYLE)!.version;
      expect(pluginVersion).toBeGreaterThan(SUPPORTED_SKILL_VERSION);
      expect(loadSkillFile(r.registry, PLUGIN_STYLE).source).toBe('plugin');

      const res = await request(r.app).post('/api/spec-skills/style-forks').send({ slug: PLUGIN_STYLE });
      expect(res.status).toBe(201);

      // The copy's own version is the smaller of the two — the supported one here.
      const data = await r.frontmatterOf(PLUGIN_STYLE);
      expect(data.version).toBe(Math.min(pluginVersion, SUPPORTED_SKILL_VERSION));
      expect(data.version).toBe(SUPPORTED_SKILL_VERSION);
      // load_skill_file now serves the copy, from `project-rooted`, not an invalid package.
      const served = loadSkillFile(r.registry, PLUGIN_STYLE);
      expect(served.source).toBe('project-rooted');
      expect(served.invalid).toBeUndefined();

      // A style already at a supported version keeps its own.
      const other = await request(r.app).post('/api/spec-skills/style-forks').send({ slug: INACTIVE_PLUGIN_STYLE });
      expect(other.status).toBe(201);
      expect((await r.frontmatterOf(INACTIVE_PLUGIN_STYLE)).version).toBe(1);
    } finally {
      await r.close();
    }
  });

  it('[ac:m52-style-fork-records-forked-from] after a fork the copy\'s SKILL.md frontmatter carries forkedFrom = plugin:<slug>@<version>, <version> being the plugin style\'s version at the moment of the fork', async () => {
    const r = await forkRig();
    try {
      const pluginVersion = r.registry.winnerOf(PLUGIN_STYLE)!.version;
      expect((await request(r.app).post('/api/spec-skills/style-forks').send({ slug: PLUGIN_STYLE })).status).toBe(201);
      const data = await r.frontmatterOf(PLUGIN_STYLE);
      expect(data.forkedFrom).toBe(`plugin:${PLUGIN_STYLE}@${pluginVersion}`);
      // The plugin's version, not the copy's clamped one.
      expect(data.forkedFrom).toBe(`plugin:${PLUGIN_STYLE}@2`);
      expect(data.version).not.toBe(pluginVersion);

      expect((await request(r.app).post('/api/spec-skills/style-forks').send({ slug: INACTIVE_PLUGIN_STYLE })).status).toBe(201);
      expect((await r.frontmatterOf(INACTIVE_PLUGIN_STYLE)).forkedFrom).toBe(`plugin:${INACTIVE_PLUGIN_STYLE}@1`);
    } finally {
      await r.close();
    }
  });
});
