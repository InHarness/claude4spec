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
    expect(resolved.files).toEqual({ 'examples/a.md': 'x' });
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

  it('does not clobber a same-slug bundled contextual skill', () => {
    // A bundled contextual skill is kept (only user-root contextual skills drop).
    const bundledRoot = writeSkill(path.join(tmp, 'bundled'), 'terse', 'bundled', 'Ctx', 'contextual');
    const registry = SkillRegistry.load([bundledRoot]);
    registry.addPluginStyle(style({ title: 'Plugin Terse' }));

    const meta = registry.list().find((s) => s.slug === 'terse');
    // The contextual skill survives — not flipped to a selectable writing-style.
    expect(meta?.scope).toBe('contextual');
    expect(meta?.source).toBe('bundled');
    expect(registry.isSelectable('terse')).toBe(false);
    expect(registry.listSelectable().some((s) => s.slug === 'terse')).toBe(false);
  });
});
