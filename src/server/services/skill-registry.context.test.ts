import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillRegistry, SkillResolver, type SkillRoot } from './skill-registry.js';

/** Write a SKILL.md with arbitrary frontmatter overrides and return the root spec. */
function writeSkill(
  root: string,
  slug: string,
  source: SkillRoot['source'],
  fm: { title?: string; description?: string; version?: number; language?: string; scope?: string; injection?: string } = {},
): SkillRoot {
  const f = { title: slug, description: `from ${source}`, version: 1, language: 'en', scope: 'writing-style', ...fm };
  const dir = path.join(root, slug);
  fs.mkdirSync(dir, { recursive: true });
  const injectionLine = f.injection !== undefined ? `injection: ${f.injection}\n` : '';
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\ntitle: ${f.title}\ndescription: ${f.description}\nversion: ${f.version}\nlanguage: ${f.language}\nscope: ${f.scope}\n${injectionLine}---\nbody from ${source}\n`,
  );
  return { dir: root, source };
}

/** Write a minimal `.claude4spec/config.json` with just `writingStyle` set, for SkillResolver tests. */
function writeConfig(cwd: string, writingStyle: string | null): void {
  const dir = path.join(cwd, '.claude4spec');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ writingStyle }));
}

/**
 * A contextual skill, which since 0.2.66 can ONLY be a package's contribution: the
 * FS roots admit `scope: 'writing-style'` and nothing else, and the in-package root
 * that used to carry one is gone.
 */
function pushContextual(
  registry: SkillRegistry,
  slug: string,
  opts: { description?: string; contextTypes?: ('chat' | 'brief' | 'patch' | 'ask')[] } = {},
): void {
  registry.addPluginSkill({
    slug,
    title: slug,
    description: opts.description ?? `from plugin ${slug}`,
    version: 1,
    language: 'en',
    scope: 'contextual',
    ...(opts.contextTypes ? { contextTypes: opts.contextTypes } : {}),
    content: `body of ${slug}`,
  });
}

describe('SkillRegistry — legacy `injection` frontmatter (0.2.19: retired)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-injection-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('loads a skill whose frontmatter still carries injection, ignoring the field', () => {
    const root = writeSkill(path.join(tmp, 'styles'), 'my-style', 'user', { injection: 'available' });
    const registry = SkillRegistry.load([root]);
    expect(registry.has('my-style')).toBe(true);
    expect(registry.isSelectable('my-style')).toBe(true);
    expect(registry.resolve('my-style').metadata).not.toHaveProperty('injection');
  });

  it('does NOT skip a skill whose injection value is nonsense — an unknown key is an unknown key', () => {
    // Pre-0.2.19 this threw during parse and dropped the style from selection.
    // Upgrading the host must not silently unselect a style authored against the
    // old frontmatter, so an invalid value of a retired field cannot be fatal.
    const root = writeSkill(path.join(tmp, 'styles'), 'legacy-style', 'user', { injection: 'sometimes' });
    const registry = SkillRegistry.load([root]);
    expect(registry.has('legacy-style')).toBe(true);
    expect(registry.listSelectable().map((s) => s.slug)).toContain('legacy-style');
  });

  it('carries no injection into what a turn resolves', () => {
    const root = writeSkill(path.join(tmp, 'styles'), 'house-style', 'user', { injection: 'forced' });
    const registry = SkillRegistry.load([root]);
    writeConfig(tmp, 'house-style');
    const { writingStyle } = new SkillResolver(registry, tmp).resolveForContext('chat');
    expect(writingStyle).toEqual({ slug: 'house-style', title: 'house-style' });
  });
});

describe('SkillRegistry — the whole package is held in memory (0.2.19; metrics 0.2.36)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-files-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('collects every file except SKILL.md, whatever directory it sits in', () => {
    // The retired whitelist was ['templates','examples','workflows']; `reference/`
    // and a root-level file were silently invisible to the model.
    const root = writeSkill(path.join(tmp, 'styles'), 'house-style', 'user');
    const dir = path.join(root.dir, 'house-style');
    fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'reference', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'workflows', 'brief.md'), 'brief methodology');
    fs.writeFileSync(path.join(dir, 'reference', 'deep', 'glossary.md'), 'terms');
    fs.writeFileSync(path.join(dir, 'NOTES.md'), 'loose note at the package root');

    const files = SkillRegistry.load([root]).resolve('house-style').files;
    expect(Object.keys(files).sort()).toEqual([
      'NOTES.md',
      'reference/deep/glossary.md',
      'workflows/brief.md',
    ]);
    expect(files['workflows/brief.md'].content).toBe('brief methodology');
    // SKILL.md travels as `content`; shipping it twice would be the body duplicated.
    expect(files).not.toHaveProperty('SKILL.md');
  });

  it('0.2.36: carries per-file metrics — the manifest load_skill_file emits', () => {
    const root = writeSkill(path.join(tmp, 'styles'), 'house-style', 'user');
    const dir = path.join(root.dir, 'house-style');
    fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'workflows', 'brief.md'), 'one\ntwo\nthree\n');

    const entry = SkillRegistry.load([root]).resolve('house-style').files['workflows/brief.md'];
    expect(entry).toEqual({
      path: 'workflows/brief.md',
      bytes: 14,
      lines: 3,
      isText: true,
      content: 'one\ntwo\nthree\n',
    });
  });

  it('0.2.36: a BINARY file stays in the package with isText:false and no content', () => {
    // It used to be dropped with a console warn, which made "the author never wrote
    // it" and "this channel will not serve it" the same observation from the model's
    // side. The manifest entry is what makes the later NOT_TEXT refusal predictable.
    const root = writeSkill(path.join(tmp, 'styles'), 'house-style', 'user');
    const dir = path.join(root.dir, 'house-style');
    fs.writeFileSync(path.join(dir, 'diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x00, 0x01]));

    const entry = SkillRegistry.load([root]).resolve('house-style').files['diagram.png'];
    expect(entry).toMatchObject({ path: 'diagram.png', isText: false, content: '', lines: 0, bytes: 5 });
  });
});

describe('SkillResolver.resolveForContext', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-context-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns an empty listing and no writing style for a context type with neither', () => {
    const registry = SkillRegistry.load([]);
    const resolver = new SkillResolver(registry, tmp);
    expect(resolver.resolveForContext('brief')).toEqual({ listing: [], writingStyle: null });
  });

  it('0.2.36: resolves METADATA ONLY — no skill body is loaded on the turn path', () => {
    // The whole point of the release: a turn costs one prompt line per skill, and
    // `registry.resolve()` (the only thing that reads a package off disk) has exactly
    // one consumer left, `load_skill_file`.
    const root = writeSkill(path.join(tmp, 'styles'), 'house-style', 'user');
    const registry = SkillRegistry.load([root]);
    pushContextual(registry, 'writing-style-author', { description: 'from plugin' });
    writeConfig(tmp, 'house-style');
    const spy = vi.spyOn(registry, 'resolve');

    const { listing, writingStyle } = new SkillResolver(registry, tmp).resolveForContext('chat');

    expect(spy).not.toHaveBeenCalled();
    expect(listing).toEqual([{ slug: 'writing-style-author', description: 'from plugin' }]);
    expect(writingStyle).toEqual({ slug: 'house-style', title: 'house-style' });
  });

  it('gives a brief thread nothing but the active writing style — the mode skills are gone', () => {
    const root = writeSkill(path.join(tmp, 'styles'), 'house-style', 'user');
    const registry = SkillRegistry.load([root]);
    writeConfig(tmp, 'house-style');
    const resolver = new SkillResolver(registry, tmp);

    for (const ct of ['brief', 'patch'] as const) {
      // 0.2.36: the style is its OWN field and is deliberately absent from the
      // listing — it already has a `<project_writing_skill>` block saying rather more than
      // a listing row would.
      expect(resolver.resolveForContext(ct)).toEqual({
        listing: [],
        writingStyle: { slug: 'house-style', title: 'house-style' },
      });
    }
  });

  it('lists the contextual contributions, and the active writing style in its own field', () => {
    const root = writeSkill(path.join(tmp, 'styles'), 'house-style', 'user');
    const registry = SkillRegistry.load([root]);
    pushContextual(registry, 'writing-style-author');
    writeConfig(tmp, 'house-style');
    const resolver = new SkillResolver(registry, tmp);

    const { listing, writingStyle } = resolver.resolveForContext('chat');
    expect(listing.map((s) => s.slug)).toEqual(['writing-style-author']);
    expect(writingStyle).toEqual({ slug: 'house-style', title: 'house-style' });
  });

  /**
   * 0.2.66's headline, stated as a test. With `attachInternalSkills` gone the host
   * has no source of listing rows of its own, so a project that loaded no plugin gets
   * an EMPTY `<available_skills>` block in `chat` — the context type that used to be
   * the one row in the whole catalogue. An empty listing, never a fallback.
   */
  it('gives a chat turn an empty listing when no plugin is loaded — no hardcoded source is left', () => {
    const registry = SkillRegistry.load([]);
    const resolver = new SkillResolver(registry, tmp);
    expect(resolver.resolveForContext('chat')).toEqual({ listing: [], writingStyle: null });
  });

  it('names the active writing style in its own field, never as a listing row', () => {
    const root = writeSkill(path.join(tmp, 'styles'), 'house-style', 'user');
    const registry = SkillRegistry.load([root]);
    writeConfig(tmp, 'house-style');
    const resolver = new SkillResolver(registry, tmp);

    const { listing, writingStyle } = resolver.resolveForContext('brief');
    expect(writingStyle).toEqual({ slug: 'house-style', title: 'house-style' });
    expect(listing).toEqual([]);
  });

  /**
   * 0.2.66 — the fan-out stopped being INDISCRIMINATE without stopping being
   * unconditional. There is still no config entry and no user opt-in; what changed is
   * that the PACKAGE now says where its skill belongs, and the host stopped holding a
   * map of where to pin it.
   */
  describe('contextTypes — the package declares its own reach', () => {
    const ALL = ['chat', 'brief', 'patch', 'ask'] as const;

    it('omitting the field means ALL FOUR, not none — the default leans wide', () => {
      const registry = SkillRegistry.load([]);
      pushContextual(registry, 'everywhere');
      const resolver = new SkillResolver(registry, tmp);

      for (const ct of ALL) {
        expect(resolver.resolveForContext(ct).listing.map((x) => x.slug)).toEqual(['everywhere']);
      }
    });

    it("['chat'] lists the skill in chat and in no other context type", () => {
      const registry = SkillRegistry.load([]);
      pushContextual(registry, 'writing-style-author', { contextTypes: ['chat'] });
      const resolver = new SkillResolver(registry, tmp);

      expect(resolver.resolveForContext('chat').listing.map((x) => x.slug)).toEqual([
        'writing-style-author',
      ]);
      for (const ct of ['brief', 'patch', 'ask'] as const) {
        expect(resolver.resolveForContext(ct).listing).toEqual([]);
      }
    });

    it('honours a proper subset of more than one type', () => {
      const registry = SkillRegistry.load([]);
      pushContextual(registry, 'two-of-four', { contextTypes: ['brief', 'ask'] });
      const resolver = new SkillResolver(registry, tmp);

      const listed = ALL.filter((ct) => resolver.resolveForContext(ct).listing.length === 1);
      expect(listed).toEqual(['brief', 'ask']);
    });

    /**
     * The filter narrows DISCOVERY, not ACCESS. A model that knows the slug opens it
     * in any turn — which is what keeps the listing from silently becoming a
     * permission boundary. `load_skill_file` reads `registry.list()`, and this is the
     * registry-level half of that guarantee.
     */
    it('leaves a skill hidden from a turn fully present in the registry', () => {
      const registry = SkillRegistry.load([]);
      pushContextual(registry, 'writing-style-author', { contextTypes: ['chat'] });

      expect(new SkillResolver(registry, tmp).resolveForContext('brief').listing).toEqual([]);
      expect(registry.has('writing-style-author')).toBe(true);
      expect(registry.resolve('writing-style-author').content).toContain('writing-style-author');
    });

    /**
     * Reach is the package's statement about its OWN contribution. A user who
     * overrides the body has said nothing about which turns the skill belongs in, so
     * the override changes the description (see the fan-out suite) and not the filter.
     */
    it('keeps the contribution\'s reach when a user overrides the body', () => {
      const userRoot = writeSkill(path.join(tmp, 'user'), 'writing-style-author', 'user', {
        scope: 'writing-style',
      });
      const registry = SkillRegistry.load([userRoot]);
      pushContextual(registry, 'writing-style-author', { contextTypes: ['chat'] });
      const resolver = new SkillResolver(registry, tmp);

      expect(resolver.resolveForContext('chat').listing).toEqual([
        { slug: 'writing-style-author', description: 'from user' },
      ]);
      expect(resolver.resolveForContext('ask').listing).toEqual([]);
    });

    it('an empty array asks to appear nowhere, and is honoured rather than corrected', () => {
      const registry = SkillRegistry.load([]);
      pushContextual(registry, 'nowhere', { contextTypes: [] });
      const resolver = new SkillResolver(registry, tmp);
      for (const ct of ALL) expect(resolver.resolveForContext(ct).listing).toEqual([]);
    });
  });

  describe('the unconditional plugin fan-out (0.2.19)', () => {
    it('attaches every plugin contextual skill to ALL FOUR context types, with no config entry', () => {
      const registry = SkillRegistry.load([]);
      registry.addPluginSkill({
        slug: 'house-rules',
        title: 'House Rules',
        description: 'always on',
        version: 1,
        language: 'en',
        scope: 'contextual',
        content: 'from the plugin',
      });
      const resolver = new SkillResolver(registry, tmp); // no config.writingStyle

      for (const ct of ['chat', 'brief', 'patch', 'ask'] as const) {
        expect(resolver.resolveForContext(ct).listing).toEqual([
          { slug: 'house-rules', description: 'always on' },
        ]);
      }
    });

    it('attaches all of a plugin\'s contextual skills, not a selection of one', () => {
      const registry = SkillRegistry.load([]);
      for (const slug of ['rule-a', 'rule-b', 'rule-c']) {
        registry.addPluginSkill({
          slug,
          title: slug,
          description: slug,
          version: 1,
          language: 'en',
          scope: 'contextual',
          content: slug,
        });
      }
      const names = new SkillResolver(registry, tmp)
        .resolveForContext('ask')
        .listing.map((s) => s.slug);
      expect(names).toEqual(['rule-a', 'rule-b', 'rule-c']);
    });

    it('does NOT fan out a plugin WRITING-STYLE skill — that one is selected, not attached', () => {
      const registry = SkillRegistry.load([]);
      registry.addPluginStyle({
        slug: 'plugin-style',
        title: 'Plugin Style',
        description: 'selectable',
        version: 1,
        language: 'en',
        content: 'style body',
      });
      const resolver = new SkillResolver(registry, tmp); // config.writingStyle is null
      expect(resolver.resolveForContext('chat')).toEqual({ listing: [], writingStyle: null });
      expect(registry.listSelectable().map((s) => s.slug)).toEqual(['plugin-style']);
    });

    it('advertises the WINNING description when a user skill overrides a plugin slug', () => {
      const userRoot = writeSkill(path.join(tmp, 'user'), 'house-rules', 'user', { scope: 'writing-style' });
      const registry = SkillRegistry.load([userRoot]);
      registry.addPluginSkill({
        slug: 'house-rules',
        title: 'House Rules',
        description: 'from the plugin',
        version: 1,
        language: 'en',
        scope: 'contextual',
        content: 'PLUGIN BODY',
      });

      // 0.2.36: the listing is what the model decides from, and `load_skill_file`
      // resolves the same precedence chain. Advertising the plugin's description
      // while the operation serves the user's body would describe one document and
      // hand over another.
      const { listing } = new SkillResolver(registry, tmp).resolveForContext('brief');
      expect(listing).toEqual([{ slug: 'house-rules', description: 'from user' }]);
    });

    it('never lets a contextual attachment shadow the ACTIVE writing style of the same slug', () => {
      // A style also named by a contextual source must not turn into a listing row:
      // that would advertise as optional the one skill the project declared binding.
      const root = writeSkill(path.join(tmp, 'styles'), 'house-style', 'user');
      const registry = SkillRegistry.load([root]);
      registry.addPluginSkill({
        slug: 'house-style',
        title: 'House Style',
        description: 'plugin copy',
        version: 1,
        language: 'en',
        scope: 'contextual',
        content: 'plugin copy',
      });
      writeConfig(tmp, 'house-style');

      const { listing, writingStyle } = new SkillResolver(registry, tmp).resolveForContext('chat');
      // Title from the WINNING entry: the FS-root file outranks the plugin push.
      expect(writingStyle).toEqual({ slug: 'house-style', title: 'house-style' });
      expect(listing).toEqual([]);
    });

    it("a user override of a contribution's slug is a listing row, never the binding style", () => {
      // A user root may only author `writing-style`-scoped skills, so that IS how an
      // override of a contributed contextual slug is spelled. It must not thereby claim
      // the writing-style slot nobody selected it for — and since 0.2.36 it cannot:
      // that slot is fed by `config.writingStyle` alone, not by a file's scope.
      const userRoot = writeSkill(path.join(tmp, 'user'), 'writing-style-author', 'user', { scope: 'writing-style' });
      const registry = SkillRegistry.load([userRoot]);
      pushContextual(registry, 'writing-style-author');
      const { listing, writingStyle } = new SkillResolver(registry, tmp).resolveForContext('chat'); // no style selected

      expect(listing).toEqual([{ slug: 'writing-style-author', description: 'from user' }]);
      expect(writingStyle).toBeNull();
    });

    it('emits one entry per slug even when two plugins contribute it', () => {
      const registry = SkillRegistry.load([]);
      pushContextual(registry, 'writing-style-author', { description: 'first' });
      pushContextual(registry, 'writing-style-author', { description: 'second' });
      const { listing } = new SkillResolver(registry, tmp).resolveForContext('chat');
      // First plugin wins at push time; the turn carries the slug exactly once.
      expect(listing).toEqual([{ slug: 'writing-style-author', description: 'first' }]);
    });
  });
});

describe('SkillRegistry.listSelectable', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-selectable-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('never offers a contextual skill, and an FS root cannot author one at all', () => {
    const root = writeSkill(path.join(tmp, 'styles'), 'house-style', 'user');
    // 0.2.66 admission rule: a contextual SKILL.md in an FS root is ignored outright,
    // which is what stops a directory dropped into `.claude/skills` from swapping out
    // an envelope's contribution.
    writeSkill(root.dir, 'writing-style-author', 'user', { scope: 'contextual' });
    const registry = SkillRegistry.load([root]);
    pushContextual(registry, 'plugin-rules');

    expect(registry.has('writing-style-author')).toBe(false);
    expect(registry.listSelectable().map((s) => s.slug)).toEqual(['house-style']);
  });
});
