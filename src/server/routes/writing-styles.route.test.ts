import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { configPath, readConfig } from '../config.js';
import { FileWatchRuntime } from '../fs/watcher.js';
import { RootRegistry } from '../roots/registry.js';
import type { Root } from '../../shared/types.js';
import { registerCoreReactions } from '../workspace/core-reactions.js';
import { mountRegistryRoots } from '../workspace/root-registry-runtime.js';
import { SkillRegistry } from '../services/skill-registry.js';
import { registerProjectRootedSkills } from '../services/project-rooted-skills.js';
import { ProjectExposedSkillSource } from '../services/project-exposed-skills.js';
import { checkWritingStyleAtStart } from '../services/writing-style-start.js';
import { updateSkillFile } from '../services/skill-write.js';
import { slugify } from '../../shared/slug.js';
import {
  SKILL_SOURCES,
  WRITING_STYLE_SOURCE_BADGE,
  writingStyleOptionLabel,
  type WritingStyleSummary,
} from '../../shared/writing-styles.js';
import { configRouter } from './config.js';

/**
 * 2.1.9 — M15 Writing Styles over every source of the skill registry (M37
 * `zscui1qz`): `GET /api/writing-styles`, the `writingStyle` write of
 * `PATCH /api/config` and the start-up check.
 *
 * The rig is a project registry built the way `project-context.ts` builds it:
 * the project `.claude/skills` root (`user`, scanned on demand), the project's
 * `skills` root (`project-rooted`, M52 — its facade mounted by
 * `mountRegistryRoots`), an attached exposed project (`project-exposed`, M52)
 * and the builtin envelopes pushed into the `plugin` source by the real loader.
 */

registerCoreReactions();

const USER_ROOTS: Root[] = [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }];
const STYLE_MD = (title: string, extra = ''): string =>
  ['---', `title: ${title}`, `description: ${title} — a test style.`, 'version: 1', 'language: en', 'scope: writing-style', extra, '---', '', `# ${title}`, ''].join('\n');

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function rig(opts: { writingStyle?: string | null } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-writing-styles-all-'));
  cleanups.push(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(configPath(cwd)), { recursive: true });
  fs.writeFileSync(configPath(cwd), JSON.stringify({ $schemaVersion: 4, writingStyle: opts.writingStyle ?? null }));

  const runtime = new FileWatchRuntime({ fsEvents: false });
  cleanups.push(() => runtime.close());
  const roots = new RootRegistry(USER_ROOTS);
  const mounted = await mountRegistryRoots({ cwd, registry: roots, userRoots: USER_ROOTS, w: runtime.scoped('context:writing-styles#1') });
  const skills = mounted.rootRuntimes.find((rt) => rt.root.id === 'skills');
  expect(skills, 'the skills root has a facade').toBeDefined();

  // `user` — the project's `.claude/skills` (no global root: the test must not read $HOME).
  const userDir = path.join(cwd, '.claude', 'skills');
  const registry = SkillRegistry.load([{ dir: userDir, source: 'user', registration: 'user-project' }], { rescanTtlMs: 0 });
  // `project-rooted` — the project's `skills` root.
  registerProjectRootedSkills(registry, roots, cwd);
  // `project-exposed` — an attached exposed project whose skill scope is a writing style.
  registry.registerSource(
    new ProjectExposedSkillSource('consumer', {
      uses: () => ['house-rules'],
      listExposed: () => [
        { projectId: 'house', name: 'house-rules', description: 'The house rules.', entry: 'index.md', scope: 'writing-style', contextTypes: undefined },
      ],
      readProvider: async () => ({ content: '# House rules', files: {}, entry: 'index.md' }),
    }),
  );
  // `plugin` — the real builtin envelopes.
  const { PluginRegistryImpl } = await import('../core/plugin-host/registry.js');
  const { loadBuiltinEnvelopes } = await import('../core/plugin-host/loader.js');
  const plugins = new PluginRegistryImpl();
  await loadBuiltinEnvelopes(plugins);
  for (const skill of plugins.listSkills()) registry.addPluginSkill(skill);

  const app = express().use(express.json()).use(configRouter({ cwd, skillRegistry: registry }));
  const writeUserStyle = (slug: string, title: string) => {
    fs.mkdirSync(path.join(userDir, slug), { recursive: true });
    fs.writeFileSync(path.join(userDir, slug, 'SKILL.md'), STYLE_MD(title));
  };
  const writeRootedStyle = (slug: string, title: string) => {
    const dir = path.join(cwd, '.claude4spec', 'skills', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), STYLE_MD(title));
  };
  return { cwd, app, registry, skills: skills!, writeUserStyle, writeRootedStyle };
}

const available = async (app: express.Express): Promise<WritingStyleSummary[]> => {
  const res = await request(app).get('/writing-styles');
  expect(res.status).toBe(200);
  return res.body.available as WritingStyleSummary[];
};

describe('GET /api/writing-styles — styles of every registry source (M15, 2.1.9)', () => {
  it('[entity:writing-style-summary] each available[] element carries exactly slug, title, description, version, language and source — source a SkillSource value, no content, no files', async () => {
    const { app, writeUserStyle, writeRootedStyle } = await rig();
    writeUserStyle('team-voice', 'Team Voice');
    writeRootedStyle('project-voice', 'Project Voice');
    const res = await request(app).get('/writing-styles');
    expect(Object.keys(res.body).sort()).toEqual(['active', 'available']);
    const list = res.body.available as Array<Record<string, unknown>>;
    expect(list.length).toBeGreaterThanOrEqual(4);
    for (const s of list) {
      expect(Object.keys(s).sort(), String(s.slug)).toEqual(['description', 'language', 'slug', 'source', 'title', 'version']);
      expect(typeof s.slug).toBe('string');
      expect(typeof s.title).toBe('string');
      expect(typeof s.description).toBe('string');
      expect(typeof s.version).toBe('number');
      expect(typeof s.language).toBe('string');
      expect(SKILL_SOURCES).toContain(s.source);
    }
    expect(list.find((s) => s.slug === 'project-voice')).toEqual({
      slug: 'project-voice',
      title: 'Project Voice',
      description: 'Project Voice — a test style.',
      version: 1,
      language: 'en',
      source: 'project-rooted',
    });
  });

  it('[ac:ac-kazdy-element-available-w-get-api] every available[] element carries source from the registry\'s set of sources — all four occur, and `bundled` never does', async () => {
    const { app, writeUserStyle, writeRootedStyle } = await rig();
    writeUserStyle('team-voice', 'Team Voice');
    writeRootedStyle('project-voice', 'Project Voice');
    const list = await available(app);
    const sources = new Set(list.map((s) => s.source));
    for (const s of list) expect(SKILL_SOURCES, s.slug).toContain(s.source);
    expect([...sources].sort()).toEqual([...SKILL_SOURCES].sort());
    expect(JSON.stringify(list)).not.toContain('bundled');
  });

  it('[ac:ac-style-sa-odkrywane-z-wielu-rootow-in-pa] a scope "writing-style" entry of any registered source — .claude/skills, the project\'s skills root, an attached exposed project, a plugin — is in GET /writing-styles', async () => {
    const { app, registry, writeUserStyle, writeRootedStyle } = await rig();
    writeUserStyle('team-voice', 'Team Voice');
    writeRootedStyle('project-voice', 'Project Voice');
    const bySlug = new Map((await available(app)).map((s) => [s.slug, s.source]));
    expect(bySlug.get('team-voice')).toBe('user');
    expect(bySlug.get('project-voice')).toBe('project-rooted');
    expect(bySlug.get('house-rules')).toBe('project-exposed');
    expect(bySlug.get('layered-vertical-slices')).toBe('plugin');
    // Every writing-style winner of the registry, whatever its source, is served — and only those.
    const styles = registry.list().filter((m) => m.scope === 'writing-style').map((m) => m.slug);
    expect([...bySlug.keys()].sort()).toEqual([...new Set(styles)].sort());
  });

  it('[ac:ac-skill-writing-style-author-scope-conte] writing-style-author (scope contextual) is neither in listSelectable() nor in GET /writing-styles, and config.writingStyle set to its slug fails the start like an unknown slug', async () => {
    const { app, registry } = await rig();
    expect(registry.has('writing-style-author')).toBe(true);
    expect(registry.listSelectable().map((s) => s.slug)).not.toContain('writing-style-author');
    expect((await available(app)).map((s) => s.slug)).not.toContain('writing-style-author');
    const verdict = checkWritingStyleAtStart(registry, 'writing-style-author');
    const unknown = checkWritingStyleAtStart(registry, 'no-such-style');
    expect(verdict.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (!verdict.ok && !unknown.ok) {
      expect(verdict.reason).toBe('outside-registry');
      expect(verdict.reason).toBe(unknown.reason);
      expect(verdict.message).toContain('is not a selectable writing style');
    }
  });
});

describe('the start-up check — available list (M15 edge cases, 2.1.9)', () => {
  it('[ac:ac-lista-available-w-komunikacie-hard-fa] the "Available:" list of the start hard-fail names the styles of every source — the project\'s skills, the attached exposed project, .claude/skills and the plugins', async () => {
    const { registry, writeUserStyle, writeRootedStyle } = await rig();
    writeUserStyle('team-voice', 'Team Voice');
    writeRootedStyle('project-voice', 'Project Voice');
    const verdict = checkWritingStyleAtStart(registry, 'foo');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.message).toContain('config.json: writingStyle "foo"');
    const list = /Available: ([^.]*)/.exec(verdict.message)?.[1] ?? '';
    const listed = list.split(',').map((s) => s.trim());
    for (const slug of ['project-voice', 'house-rules', 'team-voice', 'layered-vertical-slices']) {
      expect(listed, slug).toContain(slug);
    }
  });
});

describe('PATCH /api/config { writingStyle } over every source (M15 L17, 2.1.9)', () => {
  it('[ac:ac-patch-api-config-writingstyle-na] a style added to .claude/skills (source user, scanned on demand) after start is accepted by PATCH (200) without a restart', async () => {
    const { app, cwd, writeUserStyle } = await rig();
    // Not there yet: refused.
    expect((await request(app).patch('/config').send({ writingStyle: 'late-style' })).status).toBe(400);
    writeUserStyle('late-style', 'Late Style');
    const res = await request(app).patch('/config').send({ writingStyle: 'late-style' });
    expect(res.status).toBe(200);
    expect(readConfig(cwd).writingStyle).toBe('late-style');
    expect((await available(app)).find((s) => s.slug === 'late-style')?.source).toBe('user');
  });

  it('[ac:ac-patch-api-config-writingstyle-unkn] PATCH { writingStyle: "unknown-slug" } answers 400 with the list of available styles', async () => {
    const { app, cwd, writeRootedStyle } = await rig();
    writeRootedStyle('project-voice', 'Project Voice');
    const res = await request(app).patch('/config').send({ writingStyle: 'unknown-slug' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toContain('writingStyle "unknown-slug"');
    const list = /Available: (.*)$/.exec(res.body.error.message as string)?.[1] ?? '';
    for (const slug of ['project-voice', 'house-rules', 'layered-vertical-slices']) expect(list, slug).toContain(slug);
    expect(readConfig(cwd).writingStyle).toBeNull();
  });

  it('[ac:ac-styl-user-authored-pojawia-sie-w-dropdow] a style of source `user` is offered in the writingStyle dropdown, badged by its source distinctly from every other source, and is selectable — PATCH /api/config persists it', async () => {
    const { app, cwd, writeUserStyle } = await rig();
    writeUserStyle('team-voice', 'Team Voice');
    const list = await available(app);
    const mine = list.find((s) => s.slug === 'team-voice')!;
    expect(mine.source).toBe('user');
    // The dropdown option label (the settings element uses this very function).
    expect(writingStyleOptionLabel(mine)).toBe('Team Voice — yours');
    const badges = SKILL_SOURCES.map((s) => WRITING_STYLE_SOURCE_BADGE[s]);
    expect(new Set(badges).size).toBe(SKILL_SOURCES.length);
    for (const other of list.filter((s) => s.source !== 'user')) {
      expect(writingStyleOptionLabel(other)).not.toContain('— yours');
    }
    const res = await request(app).patch('/config').send({ writingStyle: 'team-voice' });
    expect(res.status).toBe(200);
    expect(readConfig(cwd).writingStyle).toBe('team-voice');
    expect((await request(app).get('/writing-styles')).body.active).toBe('team-voice');
  });

  it('[ac:ac-styl-user-authored-utworzony-przez-writi] a style written by writing-style-author into the project\'s skills root (update_skill_file) is selectable from the next query, without a restart', async () => {
    const { app, cwd, skills } = await rig();
    const title = 'Krótki i rzeczowy';
    const slug = slugify(title);
    expect((await available(app)).map((s) => s.slug)).not.toContain(slug);
    // The write the scaffold makes — the operation, through the skills root's facade.
    await updateSkillFile(
      { skillsRoot: () => ({ pages: skills.pages }) },
      { slug, file: 'workflows/brief.md', content: '# Brief\n', expectedHash: '' },
    );
    await updateSkillFile({ skillsRoot: () => ({ pages: skills.pages }) }, { slug, content: STYLE_MD(title), expectedHash: '' });
    expect(fs.existsSync(path.join(cwd, '.claude4spec', 'skills', slug, 'SKILL.md'))).toBe(true);
    const entry = (await available(app)).find((s) => s.slug === slug);
    expect(entry?.source).toBe('project-rooted');
    const res = await request(app).patch('/config').send({ writingStyle: slug });
    expect(res.status).toBe(200);
    expect(readConfig(cwd).writingStyle).toBe(slug);
  });
});
