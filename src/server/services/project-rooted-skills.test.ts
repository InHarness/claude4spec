import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RootRegistry } from '../roots/registry.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { buildSystemPrompt } from './chat-context.js';
import { ProjectRootedSkillSource, registerProjectRootedSkills } from './project-rooted-skills.js';
import { SkillRegistry, SkillResolver } from './skill-registry.js';
import { listSkills, loadSkillFile } from './skill-operations.js';
import { DomainError } from './tags.js';

/**
 * 2.1.9 — M52's `project-rooted` skill source over the project's `skills` root
 * (`q6jr8zoj`, `9j9cxrsr`, `gx7f584v`, `rkbsi6ky`), registered under the M37
 * source contract (`zscui1qz`): both scopes, on-demand scan, the raw `SKILL.md`
 * with its `hash`, an invalid package skipped from the registry yet readable
 * (marked) under a slug no source resolves (`7pj9yx9k`).
 */

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-project-rooted-'));
  tmpDirs.push(d);
  return d;
}

const sha = (s: string): string => crypto.createHash('sha256').update(s, 'utf-8').digest('hex');

function put(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function header(fields: Record<string, string | number | string[]>): string {
  const lines = Object.entries(fields).map(([k, v]) =>
    Array.isArray(v) ? `${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]` : `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`,
  );
  return `---\n${lines.join('\n')}\n---\n`;
}

const VALID = { title: 'Reviewer', description: 'Reviews a module page.', version: 1, language: 'en' };

/** A project dir with its `skills` root (found by kind in the root registry), plus the two `.claude/skills` roots. */
function project() {
  const cwd = tmp();
  const home = tmp();
  const roots = new RootRegistry([{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }]);
  const skillsDir = path.join(cwd, roots.byKind('skills')[0]!.dir);
  const userProject = path.join(cwd, '.claude', 'skills');
  const userGlobal = path.join(home, '.claude', 'skills');
  const registry = SkillRegistry.load(
    [
      { dir: userProject, source: 'user', registration: 'user-project' },
      { dir: userGlobal, source: 'user', registration: 'user-global' },
    ],
    { rescanTtlMs: 0 },
  );
  const source = registerProjectRootedSkills(registry, roots, cwd)!;
  const resolver = new SkillResolver(registry, cwd);
  // A thread's listing: what the resolver hands the FIRST turn of a new thread.
  const nextThreadListing = (ct: 'chat' | 'brief' | 'patch' | 'ask' = 'chat') =>
    resolver.resolveForContext(ct, { writingStyle: null }).listing;
  return { cwd, skillsDir, userProject, userGlobal, registry, source, resolver, nextThreadListing };
}

describe('M52 — the project-rooted source declaration', () => {
  it('is registered over the root of kind `skills` (.claude4spec/skills), admits both scopes at the project-rooted rung, writable, on demand, no manifest limit', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { source, skillsDir, cwd } = project();
    expect(source).toBeInstanceOf(ProjectRootedSkillSource);
    expect(skillsDir).toBe(path.join(cwd, '.claude4spec', 'skills'));
    expect(source.name).toBe('project-rooted');
    expect(source.source).toBe('project-rooted');
    expect([...source.scopes]).toEqual(['writing-style', 'contextual']);
    expect(source.rank).toEqual({ 'writing-style': 'project-rooted', contextual: 'project-rooted' });
    expect(source.writable).toBe(true);
    expect(source.scan).toBe('on-demand');
    expect('manifestLimit' in source).toBe(false);
    expect(source.unresolved()).toEqual([]);
  });
});

describe('M52 — packages of the skills root in the registry', () => {
  it('[ac:ac-roota-user-claude-skills-projekt-g] a source scanned on demand (both `.claude/skills` roots and `project-rooted`) shows a new package at the next list(), without a restart', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { registry, skillsDir, userProject, userGlobal } = project();
    expect(registry.list()).toEqual([]);

    put(path.join(userProject, 'house-style', 'SKILL.md'), header({ ...VALID, title: 'House' }) + 'body\n');
    expect(registry.list().map((m) => [m.slug, m.source])).toEqual([['house-style', 'user']]);

    put(path.join(userGlobal, 'global-style', 'SKILL.md'), header({ ...VALID, title: 'Global' }) + 'body\n');
    expect(registry.list().map((m) => m.slug).sort()).toEqual(['global-style', 'house-style']);

    put(path.join(skillsDir, 'reviewer', 'SKILL.md'), header({ ...VALID, scope: 'contextual' }) + '# Reviewer\n');
    const after = registry.list();
    expect(after.map((m) => m.slug).sort()).toEqual(['global-style', 'house-style', 'reviewer']);
    expect(after.find((m) => m.slug === 'reviewer')).toMatchObject({ source: 'project-rooted', scope: 'contextual' });
    expect(registry.has('reviewer')).toBe(true);
  });

  it('[ac:m52-new-package-listed-next-thread] a new skill package is on the listing from the next thread', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { skillsDir, nextThreadListing } = project();
    const before = nextThreadListing();
    expect(before.map((e) => e.slug)).not.toContain('reviewer');

    put(path.join(skillsDir, 'reviewer', 'SKILL.md'), header({ ...VALID, scope: 'contextual' }) + '# Reviewer\n');
    // The running thread keeps the listing it was given …
    expect(before.map((e) => e.slug)).not.toContain('reviewer');
    // … and the next thread's listing carries the new package.
    expect(nextThreadListing()).toEqual([
      { slug: 'reviewer', description: 'Reviews a module page.', origin: 'project-rooted' },
    ]);
  });

  it('[ac:m52-edge-renamed-dir-old-slug-unlisted] after a package directory is renamed outside C4S, the old slug is gone from the next thread\'s listing (and the new one is on it)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { skillsDir, nextThreadListing, registry } = project();
    put(path.join(skillsDir, 'reviewer', 'SKILL.md'), header({ ...VALID, scope: 'contextual' }) + '# Reviewer\n');
    expect(nextThreadListing().map((e) => e.slug)).toEqual(['reviewer']);

    fs.renameSync(path.join(skillsDir, 'reviewer'), path.join(skillsDir, 'page-reviewer'));
    const listing = nextThreadListing().map((e) => e.slug);
    expect(listing).not.toContain('reviewer');
    expect(listing).toEqual(['page-reviewer']);
    expect(registry.has('reviewer')).toBe(false);
  });

  it('[ac:m52-invalid-frontmatter-package-not-listed] a package whose SKILL.md frontmatter is broken is not on the listing (nor in list_skills), while a valid sibling is', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { skillsDir, nextThreadListing, registry, resolver } = project();
    put(path.join(skillsDir, 'good', 'SKILL.md'), header({ ...VALID, scope: 'contextual' }) + '# Good\n');
    // No `description`.
    put(path.join(skillsDir, 'no-desc', 'SKILL.md'), header({ title: 'X', version: 1, language: 'en', scope: 'contextual' }) + '# X\n');
    // Empty `description`.
    put(path.join(skillsDir, 'empty-desc', 'SKILL.md'), header({ ...VALID, description: '  ', scope: 'contextual' }) + '# X\n');
    // A `contextTypes` value outside the enumeration.
    put(path.join(skillsDir, 'bad-ct', 'SKILL.md'), header({ ...VALID, scope: 'contextual', contextTypes: ['chat', 'review'] }) + '# X\n');
    // YAML that does not parse.
    put(path.join(skillsDir, 'broken-yaml', 'SKILL.md'), '---\ntitle: [unclosed\n---\n# X\n');
    // A directory without SKILL.md.
    put(path.join(skillsDir, 'no-entry', 'notes.md'), '# notes\n');

    expect(nextThreadListing().map((e) => e.slug)).toEqual(['good']);
    expect(listSkills(resolver).listing.map((e) => e.slug)).toEqual(['good']);
    expect(listSkills(resolver, 'chat').listing.map((e) => e.slug)).toEqual(['good']);
    expect(registry.list().map((m) => m.slug)).toEqual(['good']);
    for (const slug of ['no-desc', 'empty-desc', 'bad-ct', 'broken-yaml', 'no-entry']) expect(registry.has(slug)).toBe(false);
    // Skipped with a warning, not a crash.
    expect(warn.mock.calls.flat().join('\n')).toMatch(/no-desc \(project-rooted\): .*description/);
  });

  it('[ac:ac-skill-scope-contextual-z-korzenia-ski] a `scope: contextual` skill from the project\'s skills root is a row of <available_skills> in a `chat` turn, with origin="project-rooted"', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { skillsDir, resolver } = project();
    put(path.join(skillsDir, 'reviewer', 'SKILL.md'), header({ ...VALID, scope: 'contextual' }) + '# Reviewer\n');
    // A writing style from the same root is NOT a listing row.
    put(path.join(skillsDir, 'house-style', 'SKILL.md'), header({ ...VALID, title: 'House', description: 'Our style.' }) + '# Style\n');
    const { listing } = resolver.resolveForContext('chat', { writingStyle: null });
    const prompt = buildSystemPrompt({
      host: { listEntities: () => [] } as unknown as ProjectPluginHost,
      projectName: 'My Spec',
      cwd: '/tmp/my-spec',
      roots: [{ id: 'pages', name: 'pages', dir: 'pages', builtin: true }],
      currentPagePath: null,
      currentPageBody: null,
      contextType: 'chat',
      availableSkills: listing,
    });
    const block = /<available_skills>[\s\S]*?<\/available_skills>/.exec(prompt)?.[0] ?? '';
    expect(block).toContain('<skill slug="reviewer" description="Reviews a module page." origin="project-rooted"/>');
    expect(block).not.toContain('slug="house-style"');
  });

  it('`contextTypes` from the header narrows the listing; omitted means all four context types', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { skillsDir, nextThreadListing } = project();
    put(path.join(skillsDir, 'chat-only', 'SKILL.md'), header({ ...VALID, scope: 'contextual', contextTypes: ['chat'] }) + '# C\n');
    put(path.join(skillsDir, 'everywhere', 'SKILL.md'), header({ ...VALID, scope: 'contextual' }) + '# E\n');
    expect(nextThreadListing('chat').map((e) => e.slug).sort()).toEqual(['chat-only', 'everywhere']);
    expect(nextThreadListing('brief').map((e) => e.slug)).toEqual(['everywhere']);
  });
});

describe('M52 — load_skill_file over project-rooted packages', () => {
  it('[ac:ac-load-skill-file-slug-dla-skilla-proje] load_skill_file(slug) for a project-rooted skill returns the `hash` of its SKILL.md — with the raw file (frontmatter and tags) as content', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { skillsDir, registry } = project();
    const raw = header({ ...VALID, scope: 'contextual' }) + '# Reviewer\n\nSee <inline_mention type="dto" slug="user"/>.\n';
    put(path.join(skillsDir, 'reviewer', 'SKILL.md'), raw);
    put(path.join(skillsDir, 'reviewer', 'workflows', 'module.md'), '# Module review\n');
    const res = loadSkillFile(registry, 'reviewer');
    expect(res.source).toBe('project-rooted');
    expect(res.hash).toBe(sha(raw));
    expect(res.content).toBe(raw);
    expect(res.files).toEqual([{ path: 'workflows/module.md', bytes: 16, lines: 1, isText: true }]);
    expect(res).not.toHaveProperty('invalid');
    // The hash tracks the file on disk.
    const edited = raw + '\nMore.\n';
    put(path.join(skillsDir, 'reviewer', 'SKILL.md'), edited);
    expect(loadSkillFile(registry, 'reviewer').hash).toBe(sha(edited));
  });

  it('[ac:m52-invalid-package-loads-marked-invalid] load_skill_file on a package with a broken frontmatter, whose slug the registry does not resolve, returns it marked invalid with the reason', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { skillsDir, registry } = project();
    const raw = header({ title: 'Draft', version: 1, language: 'en' }) + '# Draft\n';
    put(path.join(skillsDir, 'draft', 'SKILL.md'), raw);
    put(path.join(skillsDir, 'draft', 'notes.md'), '# Notes\n');
    expect(registry.has('draft')).toBe(false);

    const res = loadSkillFile(registry, 'draft');
    expect(res.invalid).toBe(true);
    expect(res.invalidReason).toMatch(/description/);
    expect(res).toMatchObject({ slug: 'draft', title: 'Draft', source: 'project-rooted', content: raw, hash: sha(raw) });
    expect(res.files).toEqual([{ path: 'notes.md', bytes: 8, lines: 1, isText: true }]);
    // The subfile shape carries the mark too.
    const sub = loadSkillFile(registry, 'draft', 'notes.md');
    expect(sub).toMatchObject({ slug: 'draft', path: 'notes.md', content: '# Notes\n', invalid: true });
    expect(sub.invalidReason).toBe(res.invalidReason);
  });

  it('[ac:m52-invalid-package-loads-marked-invalid] load_skill_file on a package whose SKILL.md frontmatter is YAML that does not parse returns it marked invalid, with its raw content and hash', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { skillsDir, registry } = project();
    const raw = '---\ntitle: [unclosed\n---\n# Broken\n';
    put(path.join(skillsDir, 'broken-yaml', 'SKILL.md'), raw);
    expect(registry.has('broken-yaml')).toBe(false);

    const res = loadSkillFile(registry, 'broken-yaml');
    expect(res.invalid).toBe(true);
    expect(res.invalidReason).toMatch(/frontmatter does not parse/);
    // The owner gets the body to fix and the hash to pass as expectedHash.
    expect(res).toMatchObject({ slug: 'broken-yaml', source: 'project-rooted', content: raw, hash: sha(raw) });
  });

  it('[ac:ac-load-skill-file-na-slug-ktorego-rejes] load_skill_file on a slug the registry does not resolve, under which an invalid project-rooted package lies, serves that package with `invalid: true` and `invalidReason` instead of refusing SKILL_NOT_FOUND', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { skillsDir, registry } = project();
    // No SKILL.md at all: still served, without content.
    put(path.join(skillsDir, 'empty-pkg', 'workflows', 'a.md'), '# A\n');
    const res = loadSkillFile(registry, 'empty-pkg');
    expect(res).toMatchObject({ slug: 'empty-pkg', source: 'project-rooted', invalid: true, invalidReason: 'missing SKILL.md' });
    expect(res).not.toHaveProperty('content');
    expect(res.files?.map((f) => f.path)).toEqual(['workflows/a.md']);

    // Without such a package the refusal stands.
    let refused: unknown;
    try {
      loadSkillFile(registry, 'nowhere');
    } catch (err) {
      refused = err;
    }
    expect(refused).toBeInstanceOf(DomainError);
    expect((refused as DomainError).code).toBe('SKILL_NOT_FOUND');

    // A slug ANOTHER source resolves serves that winner, never the shadowed invalid package.
    put(path.join(skillsDir, 'mockups', 'SKILL.md'), header({ title: 'Broken', version: 1, language: 'en' }) + '# broken\n');
    registry.addPluginSkill({
      slug: 'mockups',
      title: 'Mockups',
      description: 'Plugin mockups.',
      version: 1,
      language: 'en',
      scope: 'contextual',
      content: '# plugin body\n',
    });
    const winner = loadSkillFile(registry, 'mockups');
    expect(winner).toMatchObject({ source: 'plugin', content: '# plugin body\n' });
    expect(winner).not.toHaveProperty('invalid');
  });
});
