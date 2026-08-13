import { describe, expect, it, beforeEach, afterEach } from 'vitest';
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

describe('SkillRegistry — legacy `injection` frontmatter (0.2.19: retired)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-injection-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('loads a skill whose frontmatter still carries injection, ignoring the field', () => {
    const root = writeSkill(path.join(tmp, 'bundled'), 'my-style', 'bundled', { injection: 'available' });
    const registry = SkillRegistry.load([root]);
    expect(registry.has('my-style')).toBe(true);
    expect(registry.isSelectable('my-style')).toBe(true);
    expect(registry.resolve('my-style').metadata).not.toHaveProperty('injection');
  });

  it('does NOT skip a skill whose injection value is nonsense — an unknown key is an unknown key', () => {
    // Pre-0.2.19 this threw during parse and dropped the style from selection.
    // Upgrading the host must not silently unselect a style authored against the
    // old frontmatter, so an invalid value of a retired field cannot be fatal.
    const root = writeSkill(path.join(tmp, 'bundled'), 'legacy-style', 'bundled', { injection: 'sometimes' });
    const registry = SkillRegistry.load([root]);
    expect(registry.has('legacy-style')).toBe(true);
    expect(registry.listSelectable().map((s) => s.slug)).toContain('legacy-style');
  });

  it('carries no injection into the InlineSkill metadata handed to the adapter', () => {
    const root = writeSkill(path.join(tmp, 'bundled'), 'house-style', 'bundled', { injection: 'forced' });
    const registry = SkillRegistry.load([root]);
    writeConfig(tmp, 'house-style');
    const [skill] = new SkillResolver(registry, tmp).resolveForContext('chat');
    expect(skill.metadata).not.toHaveProperty('injection');
    expect(skill.metadata?.scope).toBe('writing-style');
  });
});

describe('SkillRegistry — the whole package reaches InlineSkill.files (0.2.19)', () => {
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
    const root = writeSkill(path.join(tmp, 'bundled'), 'house-style', 'bundled');
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
    expect(files['workflows/brief.md']).toBe('brief methodology');
    // SKILL.md travels as `content`; shipping it twice would be the body duplicated.
    expect(files).not.toHaveProperty('SKILL.md');
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

  it('returns [] for a context type with no attach list and no active writing style', () => {
    const registry = SkillRegistry.load([]);
    const resolver = new SkillResolver(registry, tmp);
    expect(resolver.resolveForContext('brief')).toEqual([]);
  });

  it('gives a brief thread nothing but the active writing style — the mode skills are gone', () => {
    const bundled = writeSkill(path.join(tmp, 'bundled'), 'house-style', 'bundled');
    const registry = SkillRegistry.load([bundled]);
    writeConfig(tmp, 'house-style');
    const resolver = new SkillResolver(registry, tmp);

    expect(resolver.resolveForContext('brief').map((s) => s.name)).toEqual(['house-style']);
    expect(resolver.resolveForContext('patch').map((s) => s.name)).toEqual(['house-style']);
  });

  it('resolves the chat attach list first, then the active writing style last', () => {
    const bundled = writeSkill(path.join(tmp, 'bundled'), 'writing-style-author', 'bundled', { scope: 'contextual' });
    writeSkill(bundled.dir, 'house-style', 'bundled');
    const registry = SkillRegistry.load([bundled]);
    writeConfig(tmp, 'house-style');
    const resolver = new SkillResolver(registry, tmp);

    expect(resolver.resolveForContext('chat').map((s) => s.name)).toEqual([
      'writing-style-author',
      'house-style',
    ]);
  });

  it('warns and skips an attach-list slug missing from the registry, without throwing (bundled roots only rescan at boot — a newly bundled skill not yet picked up by a running process must degrade gracefully, not fail every turn)', () => {
    // `chat` names `writing-style-author`; an empty registry has no such skill.
    const registry = SkillRegistry.load([]);
    const resolver = new SkillResolver(registry, tmp);
    expect(resolver.resolveForContext('chat')).toEqual([]);
  });

  it('carries scope on every resolved InlineSkill, so a caller can identify the active writing style unambiguously', () => {
    const bundled = writeSkill(path.join(tmp, 'bundled'), 'house-style', 'bundled');
    const registry = SkillRegistry.load([bundled]);
    writeConfig(tmp, 'house-style');
    const resolver = new SkillResolver(registry, tmp);

    const [skill] = resolver.resolveForContext('brief');
    expect(skill.metadata?.scope).toBe('writing-style');
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
        expect(resolver.resolveForContext(ct).map((s) => s.name)).toEqual(['house-rules']);
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
      const names = new SkillResolver(registry, tmp).resolveForContext('ask').map((s) => s.name);
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
      expect(resolver.resolveForContext('chat')).toEqual([]);
      expect(registry.listSelectable().map((s) => s.slug)).toEqual(['plugin-style']);
    });

    it('lets a same-slug user skill override the CONTENT while the attachment survives', () => {
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

      const attached = new SkillResolver(registry, tmp).resolveForContext('brief');
      expect(attached.map((s) => s.name)).toEqual(['house-rules']);
      expect(attached[0].content).toContain('body from user');
      expect(attached[0].content).not.toContain('PLUGIN BODY');
    });

    it('never lets a contextual attachment shadow the ACTIVE writing style of the same slug', () => {
      // Both contextual sources report their entries as `contextual` and the dedupe
      // keeps the first, so a style also named by a contextual source would lose its
      // `writing-style` scope — and with it the one `<project_skill>` block the
      // project selected it for.
      const bundled = writeSkill(path.join(tmp, 'bundled'), 'house-style', 'bundled');
      const registry = SkillRegistry.load([bundled]);
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

      const attached = new SkillResolver(registry, tmp).resolveForContext('chat');
      expect(attached.map((s) => s.name)).toEqual(['house-style']);
      expect(attached[0].metadata?.scope).toBe('writing-style');
    });

    it('reports an attach-list skill as contextual even when the winning FILE says writing-style', () => {
      // A user root may only author `writing-style`-scoped skills, so that IS how an
      // override of a bundled contextual slug is spelled. Passing the file's scope
      // through would hand the override the writing-style slot nobody selected it for.
      const userRoot = writeSkill(path.join(tmp, 'user'), 'writing-style-author', 'user', { scope: 'writing-style' });
      const bundled = writeSkill(path.join(tmp, 'bundled'), 'writing-style-author', 'bundled', { scope: 'contextual' });
      const registry = SkillRegistry.load([userRoot, bundled]);
      const [skill] = new SkillResolver(registry, tmp).resolveForContext('chat'); // no style selected

      expect(skill.name).toBe('writing-style-author');
      expect(skill.metadata?.scope).toBe('contextual');
      expect(skill.content).toContain('body from user');
    });

    it('emits one entry per slug even when a source names it twice', () => {
      const bundled = writeSkill(path.join(tmp, 'bundled'), 'writing-style-author', 'bundled', { scope: 'contextual' });
      const registry = SkillRegistry.load([bundled]);
      // A plugin contributing the SAME slug the chat attach list hardcodes: both
      // sources name it, and the turn must still carry it exactly once.
      registry.addPluginSkill({
        slug: 'writing-style-author',
        title: 'Writing Style Author',
        description: 'plugin copy',
        version: 1,
        language: 'en',
        scope: 'contextual',
        content: 'plugin copy',
      });
      const names = new SkillResolver(registry, tmp).resolveForContext('chat').map((s) => s.name);
      expect(names).toEqual(['writing-style-author']);
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

  it('never offers a contextual skill, whatever its source', () => {
    const bundled = writeSkill(path.join(tmp, 'bundled'), 'writing-style-author', 'bundled', { scope: 'contextual' });
    writeSkill(bundled.dir, 'house-style', 'bundled');
    const registry = SkillRegistry.load([bundled]);
    registry.addPluginSkill({
      slug: 'plugin-rules',
      title: 'Plugin Rules',
      description: 'always on',
      version: 1,
      language: 'en',
      scope: 'contextual',
      content: 'body',
    });

    expect(registry.listSelectable().map((s) => s.slug)).toEqual(['house-style']);
  });
});
