import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillRegistry } from './skill-registry.js';

/** Write `<root>/<slug>/SKILL.md` on disk and return the style dir path. */
function writeStyleDir(root: string, slug: string, body = 'body'): string {
  const dir = path.join(root, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\ntitle: ${slug}\ndescription: from user\nversion: 1\nlanguage: en\nscope: writing-style\n---\n${body}\n`,
  );
  return dir;
}

describe('SkillRegistry — symlinked style dirs are discoverable (0.1.130 → next)', () => {
  let tmp: string;
  let userDir: string;
  let externalDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-symlink-'));
    userDir = path.join(tmp, 'user');
    externalDir = path.join(tmp, 'external');
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(externalDir, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('discovers and selects a style symlinked into a user root', () => {
    // Real style dir lives outside the user root; only a symlink to it sits under `.claude/skills`.
    const target = writeStyleDir(externalDir, 'terse', 'Be terse.');
    fs.symlinkSync(target, path.join(userDir, 'terse'), 'dir');

    const registry = SkillRegistry.load([{ dir: userDir, source: 'user' }], { rescanTtlMs: 0 });

    expect(registry.has('terse')).toBe(true);
    expect(registry.isSelectable('terse')).toBe(true);
    expect(registry.listSelectable().map((s) => s.slug)).toContain('terse');
    expect(registry.resolve('terse').content).toContain('Be terse.');
  });

  it('silently skips a broken symlink (no crash, not discovered)', () => {
    // Symlink pointing at a target that does not exist.
    fs.symlinkSync(path.join(externalDir, 'does-not-exist'), path.join(userDir, 'ghost'), 'dir');

    const registry = SkillRegistry.load([{ dir: userDir, source: 'user' }], { rescanTtlMs: 0 });

    expect(registry.has('ghost')).toBe(false);
    expect(registry.listSelectable()).toHaveLength(0);
  });
});
