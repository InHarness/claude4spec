import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillRegistry, type SkillRoot } from './skill-registry.js';
import type { WritingStyleContribution } from '../../shared/plugin-host/manifest.js';

function style(over: Partial<WritingStyleContribution> = {}): WritingStyleContribution {
  return {
    slug: 'terse',
    title: 'Terse',
    description: 'Short and punchy',
    version: 1,
    language: 'en',
    content: '# Terse\nBe brief.',
    ...over,
  };
}

/** Write a SKILL.md skill dir under `root` and return the root spec. */
function writeSkill(
  root: string,
  slug: string,
  source: SkillRoot['source'],
  title: string,
  scope: 'writing-style' | 'contextual' = 'writing-style',
): SkillRoot {
  const dir = path.join(root, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\ntitle: ${title}\ndescription: from ${source}\nversion: 1\nlanguage: en\nscope: ${scope}\n---\nbody from ${source}\n`,
  );
  return { dir: root, source };
}

describe('SkillRegistry — plugin writing styles (M15 phase 2)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('registers a plugin style as source "plugin" and resolves its inline body', () => {
    const registry = SkillRegistry.load([]);
    registry.addPluginStyle(style({ content: '# Terse\nBe brief.', files: { 'examples/a.md': 'x' } }));

    const sel = registry.listSelectable();
    expect(sel).toHaveLength(1);
    expect(sel[0]).toMatchObject({ slug: 'terse', source: 'plugin', scope: 'writing-style' });

    const resolved = registry.resolve('terse');
    expect(resolved.content).toBe('# Terse\nBe brief.');
    // 0.2.36: a contribution's `Record<path, string>` is widened on ingest into the
    // metric-carrying record `load_skill_file`'s manifest is built from. Contributed
    // files are text by construction — they are strings in a JS module.
    expect(resolved.files).toEqual({
      'examples/a.md': { path: 'examples/a.md', bytes: 1, lines: 1, isText: true, content: 'x' },
    });
  });

  it('a user style (project/global) wins over a same-slug plugin style', () => {
    const userRoot = writeSkill(path.join(tmp, 'user'), 'terse', 'user', 'User Terse');
    const registry = SkillRegistry.load([userRoot]);
    registry.addPluginStyle(style({ title: 'Plugin Terse' }));

    const meta = registry.listSelectable().find((s) => s.slug === 'terse');
    expect(meta?.source).toBe('user');
    expect(meta?.title).toBe('User Terse');
    // Resolve reads the FS body, not the plugin content.
    expect(registry.resolve('terse').content).toContain('body from user');
  });

  it('a plugin style overrides a same-slug bundled style', () => {
    const bundledRoot = writeSkill(path.join(tmp, 'bundled'), 'terse', 'bundled', 'Bundled Terse');
    const registry = SkillRegistry.load([bundledRoot]);
    registry.addPluginStyle(style({ title: 'Plugin Terse', content: '# plugin body' }));

    const meta = registry.listSelectable().find((s) => s.slug === 'terse');
    expect(meta?.source).toBe('plugin');
    expect(meta?.title).toBe('Plugin Terse');
    expect(registry.resolve('terse').content).toBe('# plugin body');
  });

  it('first plugin wins among plugins for the same slug', () => {
    const registry = SkillRegistry.load([]);
    registry.addPluginStyle(style({ title: 'First', version: 1 }));
    registry.addPluginStyle(style({ title: 'Second', version: 2 }));

    const meta = registry.listSelectable().find((s) => s.slug === 'terse');
    expect(meta?.title).toBe('First');
    expect(meta?.version).toBe(1);
  });

  it('isSelectable recognises a plugin style', () => {
    const registry = SkillRegistry.load([]);
    registry.addPluginStyle(style());
    expect(registry.isSelectable('terse')).toBe(true);
  });

  it('overrides a same-slug BUNDLED skill of either scope — plugin outranks bundled, full stop', () => {
    // 0.2.19: the old guard here refused to let a plugin displace a bundled
    // CONTEXTUAL skill. It was written when a plugin could only contribute
    // styles, so such a landing could only be an accident; with
    // `contributes.skills` it is a legitimate contribution, and refusing it
    // would silently drop the plugin's own skill.
    const bundledRoot = writeSkill(path.join(tmp, 'bundled'), 'terse', 'bundled', 'Ctx', 'contextual');
    const registry = SkillRegistry.load([bundledRoot]);
    registry.addPluginSkill({ ...style({ title: 'Plugin Terse' }), scope: 'contextual' });

    const meta = registry.list().find((s) => s.slug === 'terse');
    expect(meta?.source).toBe('plugin');
    expect(meta?.title).toBe('Plugin Terse');
    // Still contextual, so still not offered in the writing-style selector.
    expect(meta?.scope).toBe('contextual');
    expect(registry.isSelectable('terse')).toBe(false);
  });

  it('but never RECLASSIFIES a bundled slug: a contextual contribution leaves a bundled writing style alone', () => {
    // Taking the slug over at a different scope would drop it out of
    // `listSelectable()` and make `resolve()` return nothing for a project that
    // has it selected — the project loses its writing style to a plugin it merely
    // installed. Overriding content is the contract; reclassifying is not.
    const bundledRoot = writeSkill(path.join(tmp, 'bundled'), 'terse', 'bundled', 'Bundled Terse', 'writing-style');
    const registry = SkillRegistry.load([bundledRoot]);
    registry.addPluginSkill({ ...style({ title: 'Plugin Terse' }), scope: 'contextual' });

    const meta = registry.list().find((s) => s.slug === 'terse');
    expect(meta?.source).toBe('bundled');
    expect(meta?.scope).toBe('writing-style');
    expect(registry.isSelectable('terse')).toBe(true);
  });

  it('a plugin CONTEXTUAL skill never displaces a user-authored skill of the same slug', () => {
    const userRoot = writeSkill(path.join(tmp, 'user'), 'terse', 'user', 'User Terse');
    const registry = SkillRegistry.load([userRoot]);
    registry.addPluginSkill({ ...style({ title: 'Plugin Terse' }), scope: 'contextual' });

    const meta = registry.list().find((s) => s.slug === 'terse');
    expect(meta?.source).toBe('user');
    expect(registry.resolve('terse').content).toContain('body from user');
  });
});
