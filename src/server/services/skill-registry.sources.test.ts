import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import request from 'supertest';
import {
  SKILL_PRECEDENCE,
  SkillRegistry,
  SkillResolver,
  type SkillMetadata,
  type SkillRoot,
  type SkillScope,
  type SkillSource,
  type SkillSourceRegistration,
  type SkillRung,
} from './skill-registry.js';
import { checkWritingStyleAtStart } from './writing-style-start.js';
import { loadWorkspacePlugins } from '../core/plugin-host/loader.js';
import { PluginRegistryImpl } from '../core/plugin-host/registry.js';
import { fanPluginSkills, loadOverlayLayer } from '../workspace/project-skills.js';
import { configRouter } from '../routes/config.js';
import type {
  PluginManifest,
  PluginSkillContribution,
  WritingStyleContribution,
} from '../../shared/plugin-host/manifest.js';

/**
 * 2.1.9 — M37 collects entries from registered sources under the `SkillSource`
 * contract (`zscui1qz`), keeps one precedence chain per scope (`aw9kcadc`) and
 * names a slug it cannot resolve with a reason (`vsa4f54s`); M33 reports the
 * slugs of envelopes that did not load; M01 stops the start on an unresolvable
 * style and says why (`7yzu5k8u`).
 */

function writeSkill(
  rootDir: string,
  slug: string,
  fm: { title?: string; description?: string; scope?: string; version?: number } = {},
  body = `body of ${slug}`,
): void {
  const dir = path.join(rootDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  const f = { title: slug, description: `about ${slug}`, scope: 'writing-style', version: 1, ...fm };
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\ntitle: ${f.title}\ndescription: ${JSON.stringify(f.description)}\nversion: ${f.version}\nlanguage: en\nscope: ${f.scope}\n---\n${body}\n`,
  );
}

function style(slug: string, over: Partial<WritingStyleContribution> = {}): WritingStyleContribution {
  return { slug, title: slug, description: `style ${slug}`, version: 1, language: 'en', content: `# ${slug}`, ...over };
}

function contextual(slug: string, over: Partial<PluginSkillContribution> = {}): PluginSkillContribution {
  return {
    slug,
    title: slug,
    description: `skill ${slug}`,
    version: 1,
    language: 'en',
    scope: 'contextual',
    content: `# ${slug}`,
    ...over,
  };
}

function pluginManifest(name: string, contributes: PluginManifest['contributes'], hostApiVersion = '^2.0.0'): PluginManifest {
  return { name, version: '1.0.0', hostApiVersion, contributes };
}

function fakeImporter(modules: Record<string, unknown>) {
  return vi.fn(async (specifier: string) => {
    const key = specifier.split('?')[0]!;
    if (key in modules) return modules[key];
    throw new Error(`Cannot find package '${specifier}'`);
  });
}

/** An in-memory source standing in for one a module other than M37 registers (M52). */
function memorySource(opts: {
  name: string;
  source: SkillSource;
  scopes: SkillScope[];
  rank: Partial<Record<SkillScope, SkillRung>>;
  entries: Array<Omit<SkillMetadata, 'source' | 'path'>>;
  hash?: string;
}): SkillSourceRegistration {
  return {
    name: opts.name,
    source: opts.source,
    scopes: opts.scopes,
    rank: opts.rank,
    writable: true,
    scan: 'live',
    list: () => ({ entries: opts.entries.map((e) => ({ ...e, source: opts.source, path: '' })), skipped: [] }),
    read: (m) => ({ content: `${opts.name}:${m.slug}`, files: {}, ...(opts.hash ? { hash: opts.hash } : {}) }),
    unresolved: () => [],
  };
}

describe('M37 — skill sources, precedence and unresolved slugs (2.1.9)', () => {
  let tmp: string;
  let projectRoot: string;
  let globalRoot: string;
  let roots: SkillRoot[];
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-sources-'));
    projectRoot = path.join(tmp, 'project', '.claude', 'skills');
    globalRoot = path.join(tmp, 'home', '.claude', 'skills');
    roots = [
      { dir: projectRoot, source: 'user', registration: 'user-project' },
      { dir: globalRoot, source: 'user', registration: 'user-global' },
    ];
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const warnings = (): string => warn.mock.calls.flat().map(String).join('\n');

  it('[entity:kontrakt-skillregistry-skillmetadata-resolvedskill] list() is the full non-deduplicated set; listSelectable(), has() and resolve() follow the precedence winner', () => {
    writeSkill(projectRoot, 'house-style', { title: 'Project House' }, 'PROJECT BODY');
    writeSkill(globalRoot, 'house-style', { title: 'Global House' }, 'GLOBAL BODY');
    const registry = SkillRegistry.load(roots, { rescanTtlMs: 0 });
    registry.addPluginSkill(contextual('mockups', { contextTypes: ['chat'], files: { 'a.md': 'x' } }));

    // SkillMetadata — every field of the contract, `source` from the declaration of the registration.
    const all = registry.list();
    expect(all.filter((m) => m.slug === 'house-style').map((m) => [m.source, m.title])).toEqual([
      ['user', 'Project House'],
      ['user', 'Global House'],
    ]);
    const mockups = all.find((m) => m.slug === 'mockups')!;
    expect(mockups).toEqual({
      slug: 'mockups',
      title: 'mockups',
      description: 'skill mockups',
      version: 1,
      language: 'en',
      scope: 'contextual',
      source: 'plugin',
      contextTypes: ['chat'],
      path: '',
    });
    expect(all.find((m) => m.slug === 'house-style')!.path).toBe(path.join(projectRoot, 'house-style'));

    // listSelectable — writing styles only, one per slug, the winner.
    expect(registry.listSelectable().map((m) => [m.slug, m.title])).toEqual([['house-style', 'Project House']]);
    expect(registry.has('house-style')).toBe(true);
    expect(registry.has('mockups')).toBe(true);
    expect(registry.has('nope')).toBe(false);

    // ResolvedSkill — metadata of the winner, body without frontmatter, the package files.
    const resolved = registry.resolve('house-style');
    expect(resolved.metadata.title).toBe('Project House');
    expect(resolved.content).toBe('PROJECT BODY\n');
    expect(resolved.files).toEqual({});
    expect(registry.resolve('mockups').files['a.md']).toMatchObject({ path: 'a.md', isText: true, content: 'x' });
    expect(() => registry.resolve('nope')).toThrow(/unknown slug "nope"/);
  });

  it('a registered source is known only by its declaration: source value, admitted scopes, rung, read with hash', () => {
    const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
    registry.registerSource(
      memorySource({
        name: 'rooted',
        source: 'project-rooted',
        scopes: ['writing-style'],
        rank: { 'writing-style': 'project-rooted' },
        hash: 'sha-1',
        entries: [
          { slug: 'kept', title: 'Kept', description: 'd', version: 1, language: 'en', scope: 'writing-style' },
          { slug: 'refused', title: 'Refused', description: 'd', version: 1, language: 'en', scope: 'contextual' },
        ],
      }),
    );

    expect(registry.list().map((m) => [m.slug, m.source])).toEqual([['kept', 'project-rooted']]);
    expect(registry.has('refused')).toBe(false);
    expect(warnings()).toMatch(/refused: scope "contextual" is not admitted by source "rooted"/);
    expect(registry.resolve('kept')).toMatchObject({ content: 'rooted:kept', hash: 'sha-1' });

    // A rank must cite a rung of the admitted scope's chain; a name is an identity.
    expect(() =>
      registry.registerSource(
        memorySource({ name: 'bad', source: 'user', scopes: ['contextual'], rank: { contextual: 'user-global' }, entries: [] }),
      ),
    ).toThrow(/cites no rung/);
    expect(() =>
      registry.registerSource(
        memorySource({ name: 'rooted', source: 'project-rooted', scopes: [], rank: {}, entries: [] }),
      ),
    ).toThrow(/already registered/);

    // Unregistering a source takes its entries out from the next query.
    registry.unregisterSource('rooted');
    expect(registry.has('kept')).toBe(false);
  });

  it('keeps one precedence chain per scope, and a collision across scopes goes to the contextual entry', () => {
    expect(SKILL_PRECEDENCE).toEqual({
      'writing-style': ['project-rooted', 'user-project', 'project-exposed', 'user-global', 'plugin'],
      contextual: ['plugin', 'project-rooted', 'project-exposed'],
    });
    const entry = (slug: string, scope: SkillScope) => ({ slug, title: slug, description: slug, version: 1, language: 'en' as const, scope });
    writeSkill(projectRoot, 'ws');
    writeSkill(globalRoot, 'ws');
    const registry = SkillRegistry.load(roots, { rescanTtlMs: 0 });
    registry.addPluginStyle(style('ws'));
    registry.registerSource(
      memorySource({
        name: 'exposed',
        source: 'project-exposed',
        scopes: ['writing-style', 'contextual'],
        rank: { 'writing-style': 'project-exposed', contextual: 'project-exposed' },
        entries: [entry('ws', 'writing-style'), entry('ctx', 'contextual')],
      }),
    );
    registry.registerSource(
      memorySource({
        name: 'rooted',
        source: 'project-rooted',
        scopes: ['writing-style', 'contextual'],
        rank: { 'writing-style': 'project-rooted', contextual: 'project-rooted' },
        entries: [entry('ws', 'writing-style'), entry('ctx', 'contextual')],
      }),
    );
    registry.addPluginSkill(contextual('ctx'));

    // writing-style: project-rooted first, although registered last.
    expect(registry.resolve('ws').metadata.source).toBe('project-rooted');
    // contextual: plugin first.
    expect(registry.resolve('ctx').metadata.source).toBe('plugin');
    // The lower entries are skipped with a warning.
    expect(warnings()).toMatch(/ws: writing-style entry of source "user-project" skipped/);
    expect(warnings()).toMatch(/ctx: contextual entry of source "rooted" skipped/);

    // Across scopes: the contextual entry wins, the style is skipped with a warning.
    registry.registerSource(
      memorySource({
        name: 'exposed-ctx',
        source: 'project-exposed',
        scopes: ['contextual'],
        rank: { contextual: 'project-exposed' },
        entries: [entry('ws', 'contextual')],
      }),
    );
    expect(registry.resolve('ws').metadata).toMatchObject({ source: 'project-exposed', scope: 'contextual' });
    expect(registry.isSelectable('ws')).toBe(false);
    expect(warnings()).toMatch(/ws: writing-style entry of source "rooted" skipped — a "contextual" entry wins a collision across scopes/);
  });

  it('a listing row carries the origin of the entry that won the contextual chain', () => {
    const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
    registry.registerSource(
      memorySource({
        name: 'rooted',
        source: 'project-rooted',
        scopes: ['contextual'],
        rank: { contextual: 'project-rooted' },
        entries: [
          { slug: 'shared', title: 's', description: 'rooted copy', version: 1, language: 'en', scope: 'contextual' },
          { slug: 'own', title: 'o', description: 'rooted only', version: 1, language: 'en', scope: 'contextual' },
        ],
      }),
    );
    registry.addPluginSkill(contextual('shared', { description: 'plugin copy' }));

    const { listing } = new SkillResolver(registry, tmp).resolveForContext('chat', { writingStyle: null });
    expect(listing).toEqual([
      { slug: 'shared', description: 'plugin copy', origin: 'plugin' },
      { slug: 'own', description: 'rooted only', origin: 'project-rooted' },
    ]);
  });

  it('[ac:ac-claude-skills-lub-cwd-claude-sk] a missing or unreadable .claude/skills root is an empty root — zero skills, no error', () => {
    // projectRoot does not exist; globalRoot is a FILE, so reading it as a directory fails.
    fs.mkdirSync(path.dirname(globalRoot), { recursive: true });
    fs.writeFileSync(globalRoot, 'not a directory');

    let registry: SkillRegistry | undefined;
    expect(() => {
      registry = SkillRegistry.load(roots, { rescanTtlMs: 0 });
    }).not.toThrow();
    expect(registry!.list()).toEqual([]);
    expect(registry!.listSelectable()).toEqual([]);
    expect(registry!.has('anything')).toBe(false);
    expect(checkWritingStyleAtStart(registry!, null)).toEqual({ ok: true });
  });

  it('[ac:ac-katalog-skilli-contextual-zawiera-wyl] a contextual skill enters the registry only from a source whose declaration admits that scope', () => {
    writeSkill(projectRoot, 'dropped-ctx', { scope: 'contextual' });
    const registry = SkillRegistry.load(roots, { rescanTtlMs: 0 });
    registry.addPluginSkill(contextual('pushed-ctx'));
    registry.registerSource(
      memorySource({
        name: 'styles-only',
        source: 'project-rooted',
        scopes: ['writing-style'],
        rank: { 'writing-style': 'project-rooted' },
        entries: [{ slug: 'refused-ctx', title: 'r', description: 'r', version: 1, language: 'en', scope: 'contextual' }],
      }),
    );
    registry.registerSource(
      memorySource({
        name: 'both',
        source: 'project-exposed',
        scopes: ['writing-style', 'contextual'],
        rank: { 'writing-style': 'project-exposed', contextual: 'project-exposed' },
        entries: [{ slug: 'admitted-ctx', title: 'a', description: 'a', version: 1, language: 'en', scope: 'contextual' }],
      }),
    );

    const contextualSlugs = registry.list().filter((m) => m.scope === 'contextual').map((m) => m.slug);
    expect(contextualSlugs.sort()).toEqual(['admitted-ctx', 'pushed-ctx']);
    expect(registry.has('dropped-ctx')).toBe(false);
    expect(registry.has('refused-ctx')).toBe(false);
  });

  it('[ac:ac-katalog-stylu-dodany-do-claude-skills] a style directory added while the server runs appears in GET /api/writing-styles and is selectable, without a restart', async () => {
    const cwd = path.join(tmp, 'project');
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude4spec', 'config.json'), JSON.stringify({ $schemaVersion: 3, writingStyle: null }));
    const registry = SkillRegistry.load(roots, { rescanTtlMs: 0 });
    const app = express().use(express.json()).use(configRouter({ cwd, skillRegistry: registry }));

    const before = await request(app).get('/writing-styles');
    expect((before.body.available as Array<{ slug: string }>).map((s) => s.slug)).not.toContain('late-style');

    writeSkill(projectRoot, 'late-style');

    const after = await request(app).get('/writing-styles');
    expect(after.status).toBe(200);
    expect(after.body.available).toContainEqual(expect.objectContaining({ slug: 'late-style', source: 'user' }));
    expect(registry.isSelectable('late-style')).toBe(true);
  });

  it('[ac:ac-config-writingstyle-ustawiony-na-slug] config.writingStyle on a slug absent from listSelectable() stops the start with a readable message', () => {
    writeSkill(projectRoot, 'house-style');
    const registry = SkillRegistry.load(roots, { rescanTtlMs: 0 });

    const verdict = checkWritingStyleAtStart(registry, 'hous-style');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('outside-registry');
    expect(verdict.message).toContain('writingStyle "hous-style"');
    expect(verdict.message).toContain('not a selectable writing style');
    expect(verdict.message).toContain('Available: house-style');
    expect(checkWritingStyleAtStart(registry, 'house-style')).toEqual({ ok: true });

    // The start path throws the verdict's message — the project build stops.
    const build = fs.readFileSync(path.join(import.meta.dirname, '../workspace/project-context.ts'), 'utf8');
    expect(build).toMatch(/checkWritingStyleAtStart\(skillRegistry, initialWritingStyle\);\s*if \(!styleVerdict\.ok\) throw new Error\(styleVerdict\.message\);/);
  });

  it('[ac:ac-config-writingstyle-ustawiony-na-slug-2] config.writingStyle on a contextual skill stops the start — rejected like an unknown slug', () => {
    const registry = SkillRegistry.load(roots, { rescanTtlMs: 0 });
    registry.addPluginSkill(contextual('mockups'));
    expect(registry.has('mockups')).toBe(true);

    const verdict = checkWritingStyleAtStart(registry, 'mockups');
    expect(verdict).toMatchObject({ ok: false, reason: 'outside-registry' });
    if (verdict.ok) return;
    expect(verdict.message).toContain('not a selectable writing style');
  });

  it('[ac:ac-kolizja-slugu-skilla-miedzy-dwoma-plu] a slug contributed by two plugins: warning, first wins by discovery order, loading goes on', async () => {
    const plugins = new PluginRegistryImpl();
    const importer = fakeImporter({
      'pkg-first': { manifest: pluginManifest('@acme/first', { skills: [contextual('dup', { content: 'FIRST' })] }) },
      'pkg-second': {
        manifest: pluginManifest('@acme/second', { skills: [contextual('dup', { content: 'SECOND' }), contextual('other')] }),
      },
    });
    const { records } = await loadWorkspacePlugins(plugins, ['pkg-first', 'pkg-second'], importer);
    expect(records.map((r) => r.status)).toEqual(['loaded', 'loaded']);

    const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
    fanPluginSkills(registry, plugins);

    expect(warnings()).toMatch(/plugin skill slug "dup" is contributed more than once; keeping the first/);
    expect(registry.resolve('dup').content).toBe('FIRST');
    // The loser's package kept loading: its other skill is there.
    expect(registry.has('other')).toBe(true);
  });

  it('[ac:ac-malformed-user-skill-md-brak-frontmat] a malformed user SKILL.md is skipped with a warning — no crash, absent from available', () => {
    const noFm = path.join(projectRoot, 'no-frontmatter');
    fs.mkdirSync(noFm, { recursive: true });
    fs.writeFileSync(path.join(noFm, 'SKILL.md'), 'just a body, no frontmatter\n');
    writeSkill(projectRoot, 'blank-description', { description: '' });
    writeSkill(projectRoot, 'good-style');

    let registry: SkillRegistry | undefined;
    expect(() => {
      registry = SkillRegistry.load(roots, { rescanTtlMs: 0 });
    }).not.toThrow();
    const available = registry!.listSelectable().map((s) => s.slug);
    expect(available).toEqual(['good-style']);
    expect(registry!.has('no-frontmatter')).toBe(false);
    expect(registry!.has('blank-description')).toBe(false);
    expect(warnings()).toMatch(/no-frontmatter \(user-project\): frontmatter 'title' must be a non-empty string, skipping/);
    expect(warnings()).toMatch(/blank-description \(user-project\): frontmatter 'description' must be a non-empty string, skipping/);
  });

  it('[ac:ac-niezaufany-plugin-project-local-brak-zg] an untrusted project-local plugin brings no style: absent from listSelectable() and GET /api/writing-styles', async () => {
    const cwd = path.join(tmp, 'project');
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude4spec', 'config.json'), JSON.stringify({ $schemaVersion: 3, writingStyle: null }));
    const pkgDir = path.join(cwd, '.claude4spec', 'plugins', 'local-style');
    fs.mkdirSync(pkgDir, { recursive: true });
    const entry = path.join(pkgDir, 'index.js');
    fs.writeFileSync(entry, '// fixture');
    const importer = fakeImporter({
      [pathToFileURL(entry).href]: { manifest: pluginManifest('@local/style', { writingStyles: [style('local-style')] }) },
    });
    const base = new PluginRegistryImpl();

    const untrusted = await loadOverlayLayer(cwd, undefined, importer);
    expect(untrusted.overlayResult).toBeUndefined();
    expect(untrusted.records[0]).toMatchObject({ code: 'PLUGIN_PROJECT_UNTRUSTED', trust: 'untrusted' });
    expect(importer).not.toHaveBeenCalled();
    const registry = SkillRegistry.load(roots, { rescanTtlMs: 0 });
    fanPluginSkills(registry, base, untrusted.overlayResult);

    expect(registry.listSelectable().map((s) => s.slug)).not.toContain('local-style');
    const res = await request(express().use(configRouter({ cwd, skillRegistry: registry }))).get('/writing-styles');
    expect((res.body.available as Array<{ slug: string }>).map((s) => s.slug)).not.toContain('local-style');

    // Contrast: the same package on the trusted path does contribute the style.
    const trusted = await loadOverlayLayer(cwd, true, importer);
    const trustedRegistry = SkillRegistry.load(roots, { rescanTtlMs: 0 });
    fanPluginSkills(trustedRegistry, base, trusted.overlayResult);
    expect(trustedRegistry.listSelectable().find((s) => s.slug === 'local-style')?.source).toBe('plugin');
  });

  it('[ac:ac-skill-scope-contextual-upuszczony-d] a contextual skill in <cwd>/.claude/skills or ~/.claude/skills does not reach contextual resolution', () => {
    writeSkill(projectRoot, 'ctx-in-project', { scope: 'contextual' });
    writeSkill(globalRoot, 'ctx-in-global', { scope: 'contextual' });
    const registry = SkillRegistry.load(roots, { rescanTtlMs: 0 });
    registry.addPluginSkill(contextual('from-plugin'));
    const resolver = new SkillResolver(registry, tmp);

    for (const ct of ['chat', 'brief', 'patch', 'ask'] as const) {
      expect(resolver.resolveForContext(ct, { writingStyle: null }).listing.map((s) => s.slug)).toEqual(['from-plugin']);
    }
    expect(resolver.resolveAll().listing.map((s) => s.slug)).toEqual(['from-plugin']);
    expect(registry.has('ctx-in-project')).toBe(false);
    expect(registry.has('ctx-in-global')).toBe(false);
    expect(warnings()).toMatch(/ctx-in-project: scope "contextual" is not admitted by source "user-project"/);
    expect(warnings()).toMatch(/ctx-in-global: scope "contextual" is not admitted by source "user-global"/);
  });

  it('[ac:ac-styl-wniesiony-przez-pakiet-pominiety] a style of a package skipped by the hostApiVersion gate resolves with "envelope not loaded", not "outside the registry"', async () => {
    const plugins = new PluginRegistryImpl();
    const importer = fakeImporter({
      'pkg-old': { manifest: pluginManifest('@acme/old', { writingStyles: [style('old-style')] }, '^9.0.0') },
    });
    const { records } = await loadWorkspacePlugins(plugins, ['pkg-old', 'pkg-missing'], importer);
    expect(records[0]).toMatchObject({ code: 'PLUGIN_HOST_API_MISMATCH' });
    expect(records[1]).toMatchObject({ code: 'PLUGIN_IMPORT_FAILED' });

    const registry = SkillRegistry.load(roots, { rescanTtlMs: 0 });
    fanPluginSkills(registry, plugins);

    expect(registry.has('old-style')).toBe(false);
    expect(registry.unresolvedReason('old-style')).toMatchObject({ slug: 'old-style', reason: 'envelope-not-loaded' });
    expect(registry.unresolvedReason('old-style')?.detail).toContain('PLUGIN_HOST_API_MISMATCH');
    // A slug nobody knows — e.g. of a package whose import threw — is "outside the registry".
    expect(registry.unresolvedReason('never-heard-of')).toEqual({ slug: 'never-heard-of', reason: 'outside-registry' });

    // M01 tells the two causes apart.
    const verdict = checkWritingStyleAtStart(registry, 'old-style');
    expect(verdict).toMatchObject({ ok: false, reason: 'envelope-not-loaded' });
    if (verdict.ok) return;
    expect(verdict.message).toContain('its plugin package did not load');
    expect(verdict.message).not.toContain('not a selectable writing style');
  });

  it('an entry the loader rejects for contextTypes is reported "envelope not loaded"; the collision loser is not', () => {
    const plugins = new PluginRegistryImpl();
    plugins.registerPlugin(
      pluginManifest('@acme/mixed', {
        skills: [contextual('bad-reach', { contextTypes: ['review' as never] }), contextual('fine')],
      }),
    );
    const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
    fanPluginSkills(registry, plugins);

    expect(registry.unresolvedReason('bad-reach')).toMatchObject({ reason: 'envelope-not-loaded' });
    expect(registry.unresolvedReason('fine')).toBeNull();

    // A slug that some source still delivers stays resolved.
    registry.addUnloadedPluginSkill('fine', 'reported, but delivered anyway');
    expect(registry.unresolvedReason('fine')).toBeNull();
  });

  it('[ac:ac-ten-sam-slug-w-cwd-claude-skills-i] the same slug in <cwd>/.claude/skills and ~/.claude/skills — the project wins and the skipped global entry is logged', () => {
    writeSkill(projectRoot, 'terse', { title: 'Project Terse' }, 'PROJECT');
    writeSkill(globalRoot, 'terse', { title: 'Global Terse' }, 'GLOBAL');
    const registry = SkillRegistry.load(roots, { rescanTtlMs: 0 });

    expect(registry.listSelectable().filter((s) => s.slug === 'terse').map((s) => s.title)).toEqual(['Project Terse']);
    expect(registry.resolve('terse').content).toBe('PROJECT\n');
    expect(warnings()).toMatch(
      /terse: writing-style entry of source "user-global" skipped — "user-project" ranks higher in the "writing-style" chain/,
    );
  });

  it('[ac:ac-user-skill-o-tym-samym-slugu-co-bundled] a user style with the slug of an envelope style shadows it — listSelectable() returns the user entry', () => {
    writeSkill(globalRoot, 'layered', { title: 'Mine' });
    const registry = SkillRegistry.load(roots, { rescanTtlMs: 0 });
    registry.addPluginStyle(style('layered', { title: 'Envelope' }));

    const selectable = registry.listSelectable().filter((s) => s.slug === 'layered');
    expect(selectable).toHaveLength(1);
    expect(selectable[0]).toMatchObject({ source: 'user', title: 'Mine' });
  });
});
