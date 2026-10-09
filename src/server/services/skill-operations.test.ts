import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listSkills, loadSkillFile } from './skill-operations.js';
import {
  SkillRegistry,
  SkillResolver,
  toPackageFiles,
  type SkillMetadata,
  type SkillRoot,
  type SkillSourceRegistration,
} from './skill-registry.js';
import { KNOWN_CONTEXT_TYPES } from './chat-context.js';
import { DomainError } from './tags.js';
import { DEFAULT_BUDGET_CHARS } from '../discovery/budget.js';

/**
 * 0.2.99 M37 — the two registry operations as core functions. Every channel
 * (internal MCP, external MCP, REST, `c4s`) calls these, so the semantics are
 * asserted ONCE here; the channel tests only check the envelope around them.
 */
describe('M37 core — list_skills / load_skill_file', () => {
  let tmp: string;
  let userRoot: SkillRoot;

  function writeUserSkill(slug: string, scope: 'writing-style' | 'contextual' = 'writing-style'): string {
    const dir = path.join(userRoot.dir, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\ntitle: ${slug} title\ndescription: about ${slug}\nversion: 1\nlanguage: en\nscope: ${scope}\n---\n# ${slug}\nthe body\n`,
    );
    return dir;
  }

  function addPluginContextual(registry: SkillRegistry, slug: string, contextTypes?: Array<'chat' | 'brief' | 'patch' | 'ask'>) {
    registry.addPluginSkill({
      slug,
      title: slug,
      description: `from plugin ${slug}`,
      version: 1,
      language: 'en',
      scope: 'contextual',
      ...(contextTypes ? { contextTypes } : {}),
      content: `body of ${slug}`,
    });
  }

  function setWritingStyle(slug: string | null) {
    const dir = path.join(tmp, '.claude4spec');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ writingStyle: slug }));
  }

  function refusal(fn: () => unknown): DomainError {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      return err as DomainError;
    }
    throw new Error('expected a refusal');
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-ops-'));
    userRoot = { dir: path.join(tmp, '.claude', 'skills'), source: 'user' };
    fs.mkdirSync(userRoot.dir, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('list_skills', () => {
    it('[ac:ac-list-skills-wywolane-bez-contexttype] without contextType returns the whole registry — every contextual skill, whatever its reach', () => {
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      addPluginContextual(registry, 'everywhere');
      addPluginContextual(registry, 'brief-only', ['brief']);
      addPluginContextual(registry, 'chat-only', ['chat']);
      const resolver = new SkillResolver(registry, tmp);

      const all = listSkills(resolver);
      expect(all.listing.map((s) => s.slug)).toEqual(['everywhere', 'brief-only', 'chat-only']);
      expect(all.listing[0]).toEqual({ slug: 'everywhere', description: 'from plugin everywhere', origin: 'plugin' });

      // A context type narrows it to the resolver's set — the same answer the turn's
      // `<available_skills>` block is built from.
      expect(listSkills(resolver, 'brief').listing.map((s) => s.slug)).toEqual(['everywhere', 'brief-only']);
      expect(listSkills(resolver, 'brief')).toEqual(resolver.resolveForContext('brief'));
    });

    it('[ac:ac-list-skills-z-contexttype-spoza-enume] refuses a contextType outside the enumeration with INVALID_ARGUMENT', () => {
      const resolver = new SkillResolver(SkillRegistry.load([]), tmp);
      expect(refusal(() => listSkills(resolver, 'breif')).code).toBe('INVALID_ARGUMENT');
      // An empty string is not "omitted" — it is a value, and not a legal one.
      expect(refusal(() => listSkills(resolver, '')).code).toBe('INVALID_ARGUMENT');
    });

    it('[ac:ac-komunikat-odmowy-list-skills-przy-con] names every legal value in the refusal', () => {
      const resolver = new SkillResolver(SkillRegistry.load([]), tmp);
      const err = refusal(() => listSkills(resolver, 'breif'));
      expect(KNOWN_CONTEXT_TYPES).toEqual(['chat', 'brief', 'patch', 'ask']);
      for (const legal of KNOWN_CONTEXT_TYPES) expect(err.message).toContain(legal);
    });

    it('[ac:ac-list-skills-zwraca-wskazanie-aktywneg] reports the active writing style beside the listing, never as a row', () => {
      writeUserSkill('house-style');
      writeUserSkill('other-style');
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      addPluginContextual(registry, 'mockups');
      setWritingStyle('house-style');
      const resolver = new SkillResolver(registry, tmp);

      for (const res of [listSkills(resolver), ...KNOWN_CONTEXT_TYPES.map((ct) => listSkills(resolver, ct))]) {
        expect(res.writingStyle).toEqual({ slug: 'house-style', title: 'house-style title' });
        const slugs = res.listing.map((s) => s.slug);
        expect(slugs).toEqual(['mockups']);
        // Neither the active style nor an inactive one is a listing row.
        expect(slugs).not.toContain('house-style');
        expect(slugs).not.toContain('other-style');
      }
    });

    it('answers { listing: [], writingStyle: null } for an empty registry — a true answer, not a refusal', () => {
      const resolver = new SkillResolver(SkillRegistry.load([]), tmp);
      expect(listSkills(resolver)).toEqual({ listing: [], writingStyle: null });
      expect(listSkills(resolver, 'ask')).toEqual({ listing: [], writingStyle: null });
    });

    it('dedupes by slug and follows precedence for the description', () => {
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      addPluginContextual(registry, 'dup');
      addPluginContextual(registry, 'dup', ['ask']); // second push of one slug is ignored
      const res = listSkills(new SkillResolver(registry, tmp));
      expect(res.listing.filter((s) => s.slug === 'dup')).toHaveLength(1);
    });

    it('[ac:ac-skill-scope-contextual-upuszczony-prz] leaves out a scope: contextual skill a user dropped into .claude/skills', () => {
      writeUserSkill('sneaky', 'contextual');
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      addPluginContextual(registry, 'from-plugin');
      const resolver = new SkillResolver(registry, tmp);

      for (const res of [listSkills(resolver), ...KNOWN_CONTEXT_TYPES.map((ct) => listSkills(resolver, ct))]) {
        expect(res.listing.map((s) => s.slug)).toEqual(['from-plugin']);
      }
    });

    it('sees a style dropped into .claude/skills on the next call, without a restart', () => {
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      const resolver = new SkillResolver(registry, tmp);
      setWritingStyle('late-style');
      expect(listSkills(resolver).writingStyle).toBeNull();
      writeUserSkill('late-style');
      expect(listSkills(resolver).writingStyle).toEqual({ slug: 'late-style', title: 'late-style title' });
    });
  });

  describe('load_skill_file', () => {
    /**
     * A registered source standing in for one that declares a manifest limit and a
     * `hash` (the shape M52's sources take) — the registry only knows the contract.
     */
    function limitedSource(opts: { manifestLimit?: number; hash?: string; files: Record<string, string> }): SkillSourceRegistration {
      const meta: SkillMetadata = {
        slug: 'exposed-skill',
        title: 'Exposed skill',
        description: 'from a source with a manifest limit',
        version: 1,
        language: 'en',
        scope: 'contextual',
        source: 'project-exposed',
        path: '',
      };
      return {
        name: 'test-limited',
        source: 'project-exposed',
        scopes: ['contextual'],
        rank: { contextual: 'project-exposed' },
        writable: opts.hash !== undefined,
        scan: 'live',
        ...(opts.manifestLimit !== undefined ? { manifestLimit: opts.manifestLimit } : {}),
        list: () => ({ entries: [meta], skipped: [] }),
        read: () => ({
          content: '# exposed\nbody',
          files: toPackageFiles(opts.files),
          ...(opts.hash !== undefined ? { hash: opts.hash } : {}),
        }),
        unresolved: () => [],
      };
    }

    it('[ac:ac-wywolanie-load-skill-file-slug-bez-fi] opening returns the body with one manifest row { path, bytes, lines, isText } per other file, up to the limit the source declares', () => {
      // No limit declared (`user` source): every other file of the package is a row.
      const dir = writeUserSkill('house-style');
      fs.mkdirSync(path.join(dir, 'workflows'));
      fs.writeFileSync(path.join(dir, 'workflows', 'brief.md'), 'one\ntwo\n');
      fs.writeFileSync(path.join(dir, 'NOTES.md'), 'n\n');
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      const open = loadSkillFile(registry, 'house-style');
      expect(open.content).toContain('the body');
      expect(open.files).toEqual([
        { path: 'NOTES.md', bytes: 2, lines: 1, isText: true },
        { path: 'workflows/brief.md', bytes: 8, lines: 2, isText: true },
      ]);
      expect(open.truncated).toBeUndefined();

      // A source declaring a limit of 2: the manifest is cut to it and says so.
      registry.registerSource(
        limitedSource({ manifestLimit: 2, files: { 'a.md': 'a\n', 'b.md': 'bb\n', 'c.md': 'ccc\n' } }),
      );
      const cut = loadSkillFile(registry, 'exposed-skill');
      expect(cut.content).toBe('# exposed\nbody');
      expect(cut.files).toEqual([
        { path: 'a.md', bytes: 2, lines: 1, isText: true },
        { path: 'b.md', bytes: 3, lines: 1, isText: true },
      ]);
      expect(cut.truncated).toBe(true);
      expect(cut.truncationHint).toContain('2 of its 3');
      // A file left out of the cut manifest stays addressable by (slug, file).
      expect(loadSkillFile(registry, 'exposed-skill', 'c.md')).toEqual({ slug: 'exposed-skill', path: 'c.md', content: 'ccc\n' });
    });

    it('opening carries the winner\'s `source`, and `hash` only when its source returns one', () => {
      writeUserSkill('house-style');
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      addPluginContextual(registry, 'mockups');
      registry.registerSource(limitedSource({ hash: 'sha256:abc', files: {} }));

      const user = loadSkillFile(registry, 'house-style');
      expect(user.source).toBe('user');
      expect(user).not.toHaveProperty('hash');
      const plugin = loadSkillFile(registry, 'mockups');
      expect(plugin.source).toBe('plugin');
      expect(plugin).not.toHaveProperty('hash');
      const exposed = loadSkillFile(registry, 'exposed-skill');
      expect(exposed).toMatchObject({ source: 'project-exposed', hash: 'sha256:abc' });
      // A subfile read carries neither — they belong to the opening shape.
      expect(loadSkillFile(registry, 'house-style', 'SKILL.md')).not.toHaveProperty('source');
    });

    it('[ac:ac-skill-user-authored-o-tym-samym-slugu] a user writing-style colliding with a plugin contextual slug: load_skill_file serves the plugin entry', () => {
      writeUserSkill('shared-slug');
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      addPluginContextual(registry, 'shared-slug');

      const res = loadSkillFile(registry, 'shared-slug');
      expect(res.content).toBe('body of shared-slug');
      expect(res.content).not.toContain('the body');
      expect(res).toMatchObject({ source: 'plugin', scope: 'contextual', description: 'from plugin shared-slug' });
    });

    it('SKILL_NOT_FOUND names the reason a known slug is unresolved: a plugin package that did not load', () => {
      writeUserSkill('house-style');
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      registry.addUnloadedPluginSkill('lost-style', 'package "c4s-plugin-lost" was skipped: host API mismatch');

      const err = refusal(() => loadSkillFile(registry, 'lost-style'));
      expect(err.code).toBe('SKILL_NOT_FOUND');
      expect(err.message).toContain('did not load');
      expect(err.message).toContain('c4s-plugin-lost');
    });

    it('opens a package: body without frontmatter, metadata, manifest — and no disk path anywhere', () => {
      const dir = writeUserSkill('house-style');
      fs.mkdirSync(path.join(dir, 'workflows'));
      fs.writeFileSync(path.join(dir, 'workflows', 'brief.md'), 'one\ntwo\n');
      const res = loadSkillFile(SkillRegistry.load([userRoot], { rescanTtlMs: 0 }), 'house-style');

      expect(res).toMatchObject({
        slug: 'house-style',
        title: 'house-style title',
        description: 'about house-style',
        scope: 'writing-style',
        files: [{ path: 'workflows/brief.md', bytes: 8, lines: 2, isText: true }],
      });
      expect(res.content).not.toContain('---');
      expect(res.content).toContain('the body');
      expect(res.path).toBeUndefined();
      expect(JSON.stringify(res)).not.toContain(tmp);
    });

    it('reads a subfile by (slug, file)', () => {
      const dir = writeUserSkill('house-style');
      fs.mkdirSync(path.join(dir, 'workflows'));
      fs.writeFileSync(path.join(dir, 'workflows', 'brief.md'), 'methodology\n');
      const res = loadSkillFile(SkillRegistry.load([userRoot], { rescanTtlMs: 0 }), 'house-style', 'workflows/brief.md');
      expect(res).toEqual({ slug: 'house-style', path: 'workflows/brief.md', content: 'methodology\n' });
    });

    it('answers the four refusals with their codes', () => {
      const dir = writeUserSkill('house-style');
      fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0xff, 0xfe]));
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });

      expect(refusal(() => loadSkillFile(registry, 'hose-style')).code).toBe('SKILL_NOT_FOUND');
      expect(refusal(() => loadSkillFile(registry, 'house-style', 'nope.md')).code).toBe('SKILL_FILE_NOT_FOUND');
      expect(refusal(() => loadSkillFile(registry, 'house-style', '../../etc/passwd')).code).toBe('INVALID_ARGUMENT');
      expect(refusal(() => loadSkillFile(registry, 'house-style', '/etc/passwd')).code).toBe('INVALID_ARGUMENT');
      // [ac:ac-odczyt-podpliku-binarnego-odmawia-tym] — the manifest announced it.
      expect(loadSkillFile(registry, 'house-style').files).toContainEqual(expect.objectContaining({ path: 'logo.png', isText: false }));
      expect(refusal(() => loadSkillFile(registry, 'house-style', 'logo.png')).code).toBe('NOT_TEXT');
    });

    it('[ac:ac-budzet-uciecia-tresci-podpliku-jest-i] cuts a subfile at the one shared DEFAULT_BUDGET_CHARS', () => {
      expect(DEFAULT_BUDGET_CHARS).toBe(50_000);
      const dir = writeUserSkill('big');
      fs.writeFileSync(path.join(dir, 'huge.md'), 'x'.repeat(DEFAULT_BUDGET_CHARS + 10));
      const res = loadSkillFile(SkillRegistry.load([userRoot], { rescanTtlMs: 0 }), 'big', 'huge.md');
      expect(res.content).toHaveLength(DEFAULT_BUDGET_CHARS);
      expect(res.truncated).toBe(true);
      expect(res.truncationHint).toContain('huge.md');
      expect(res.path).toBe('huge.md');
    });

    it('[ac:ac-wolajacy-spoza-procesu-otwiera-skill] opens a skill no context type lists — visibility is not permission', () => {
      writeUserSkill('house-style');
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      const resolver = new SkillResolver(registry, tmp); // no active style → house-style is in no set
      expect(listSkills(resolver).listing).toEqual([]);
      for (const ct of KNOWN_CONTEXT_TYPES) expect(listSkills(resolver, ct).listing).toEqual([]);

      expect(loadSkillFile(registry, 'house-style').content).toContain('the body');
    });
  });
});
