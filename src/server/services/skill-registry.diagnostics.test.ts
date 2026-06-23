import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillRegistry, type SkillRoot } from './skill-registry.js';

/** Write a SKILL.md with arbitrary frontmatter overrides and return the root spec. */
function writeSkill(
  root: string,
  slug: string,
  source: SkillRoot['source'],
  fm: { title?: string; description?: string; version?: number; language?: string; scope?: string } = {},
): SkillRoot {
  const f = { title: slug, description: `from ${source}`, version: 1, language: 'en', scope: 'writing-style', ...fm };
  const dir = path.join(root, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\ntitle: ${f.title}\ndescription: ${f.description}\nversion: ${f.version}\nlanguage: ${f.language}\nscope: ${f.scope}\n---\nbody\n`,
  );
  return { dir: root, source };
}

describe('SkillRegistry — unselectableReason diagnostics', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-diag-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('explains a version-skip: skill on disk but version > supported', () => {
    const root = writeSkill(path.join(tmp, 'user'), 'ws-future', 'user', { version: 2 });
    const registry = SkillRegistry.load([root]);

    // Skipped at scan time — never registered, never selectable.
    expect(registry.has('ws-future')).toBe(false);
    expect(registry.isSelectable('ws-future')).toBe(false);
    expect(registry.listSelectable().some((s) => s.slug === 'ws-future')).toBe(false);

    // ...but the reason names the version mismatch instead of just listing alternatives.
    const reason = registry.unselectableReason('ws-future');
    expect(reason).toContain('found on disk but skipped');
    expect(reason).toContain('version 2 > supported 1');
  });

  it('explains a contextual-in-user-root skip', () => {
    const root = writeSkill(path.join(tmp, 'user'), 'ctx-skill', 'user', { scope: 'contextual' });
    const registry = SkillRegistry.load([root]);

    expect(registry.isSelectable('ctx-skill')).toBe(false);
    expect(registry.unselectableReason('ctx-skill')).toContain('contextual');
  });

  it('falls back to the "Available: ..." list for a genuinely-unknown slug', () => {
    const root = writeSkill(path.join(tmp, 'user'), 'real-style', 'user');
    const registry = SkillRegistry.load([root]);

    const reason = registry.unselectableReason('does-not-exist');
    expect(reason).toContain('not a selectable writing-style skill');
    expect(reason).toContain('Available: real-style');
  });

  it('drops the skip once a later root supplies a valid same-slug skill', () => {
    // Higher-precedence root skips (version too high); lower-precedence root is valid.
    const userRoot = writeSkill(path.join(tmp, 'user'), 'dup', 'user', { version: 2 });
    const bundledRoot = writeSkill(path.join(tmp, 'bundled'), 'dup', 'bundled', { version: 1 });
    const registry = SkillRegistry.load([userRoot, bundledRoot]);

    expect(registry.isSelectable('dup')).toBe(true);
    // No stale skip reason — it resolves to the "Available" form, listing itself.
    expect(registry.unselectableReason('dup')).toContain('Available: dup');
  });
});
