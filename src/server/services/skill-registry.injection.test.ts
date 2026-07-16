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

describe('SkillRegistry — injection frontmatter', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-injection-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('defaults to "forced" when frontmatter omits injection', () => {
    const root = writeSkill(path.join(tmp, 'bundled'), 'my-style', 'bundled');
    const registry = SkillRegistry.load([root]);
    expect(registry.resolve('my-style').metadata.injection).toBe('forced');
  });

  it('honours an explicit "available"', () => {
    const root = writeSkill(path.join(tmp, 'bundled'), 'style-author', 'bundled', { scope: 'contextual', injection: 'available' });
    const registry = SkillRegistry.load([root]);
    expect(registry.resolve('style-author').metadata.injection).toBe('available');
  });

  it('skips a skill with an invalid injection value', () => {
    const root = writeSkill(path.join(tmp, 'bundled'), 'bad-injection', 'bundled', { injection: 'sometimes' });
    const registry = SkillRegistry.load([root]);
    expect(registry.has('bad-injection')).toBe(false);
    expect(registry.unselectableReason('bad-injection')).toContain("injection");
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

  it('returns [] when attachInternalSkills is empty and no writing style is active', () => {
    const registry = SkillRegistry.load([]);
    const resolver = new SkillResolver(registry, tmp);
    expect(resolver.resolveForContext([])).toEqual([]);
  });

  it('resolves attach-list slugs in order, then appends the active writing style last', () => {
    const bundled = writeSkill(path.join(tmp, 'bundled'), 'brief-author', 'bundled', { scope: 'contextual' });
    writeSkill(bundled.dir, 'house-style', 'bundled');
    const registry = SkillRegistry.load([bundled]);
    writeConfig(tmp, 'house-style');
    const resolver = new SkillResolver(registry, tmp);

    const result = resolver.resolveForContext(['brief-author']);
    expect(result.map((s) => s.name)).toEqual(['brief-author', 'house-style']);
  });

  it('throws for an attach-list slug missing from the registry (broken bundled-skills install, not a recoverable user mistake)', () => {
    const registry = SkillRegistry.load([]);
    const resolver = new SkillResolver(registry, tmp);
    expect(() => resolver.resolveForContext(['does-not-exist'])).toThrow(/does-not-exist/);
  });

  it('marks an "available" attach-list skill in inlineSkills metadata, distinguishing it from forced ones', () => {
    const bundled = writeSkill(path.join(tmp, 'bundled'), 'writing-style-author', 'bundled', {
      scope: 'contextual',
      injection: 'available',
    });
    const registry = SkillRegistry.load([bundled]);
    const resolver = new SkillResolver(registry, tmp);

    const [skill] = resolver.resolveForContext(['writing-style-author']);
    expect(skill.metadata?.injection).toBe('available');
  });

  it('carries scope on every resolved InlineSkill, so a caller can identify the active writing style unambiguously', () => {
    const bundled = writeSkill(path.join(tmp, 'bundled'), 'house-style', 'bundled');
    const registry = SkillRegistry.load([bundled]);
    writeConfig(tmp, 'house-style');
    const resolver = new SkillResolver(registry, tmp);

    const [skill] = resolver.resolveForContext([]);
    expect(skill.metadata?.scope).toBe('writing-style');
  });
});
