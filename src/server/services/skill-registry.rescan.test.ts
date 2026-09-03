import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillRegistry, type SkillRoot } from './skill-registry.js';

/** Write `<root>/<slug>/SKILL.md` on disk and return the root spec. */
function writeSkill(
  root: string,
  slug: string,
  source: SkillRoot['source'],
  opts: { scope?: string; body?: string } = {},
): SkillRoot {
  const { scope = 'writing-style', body = 'body' } = opts;
  const dir = path.join(root, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\ntitle: ${slug}\ndescription: from ${source}\nversion: 1\nlanguage: en\nscope: ${scope}\n---\n${body}\n`,
  );
  return { dir: root, source };
}

describe('SkillRegistry — on-demand user-root re-scan (0.1.87)', () => {
  let tmp: string;
  let userDir: string;
  let globalDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-rescan-'));
    userDir = path.join(tmp, 'user');
    globalDir = path.join(tmp, 'global');
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('picks up a style dropped into a user root after load — no reload', () => {
    // Load over a user root that does not exist yet (treated as empty).
    const registry = SkillRegistry.load([{ dir: userDir, source: 'user' }], { rescanTtlMs: 0 });
    expect(registry.has('terse')).toBe(false);
    expect(registry.listSelectable()).toHaveLength(0);

    // Author a style on disk while the registry is live.
    writeSkill(userDir, 'terse', 'user', { body: 'Be terse.' });

    expect(registry.has('terse')).toBe(true);
    expect(registry.isSelectable('terse')).toBe(true);
    expect(registry.listSelectable().map((s) => s.slug)).toContain('terse');
    expect(registry.resolve('terse').content).toContain('Be terse.');
  });

  it('drops a user style removed from disk after load', () => {
    const root = writeSkill(userDir, 'terse', 'user');
    const registry = SkillRegistry.load([root], { rescanTtlMs: 0 });
    expect(registry.has('terse')).toBe(true);

    fs.rmSync(path.join(userDir, 'terse'), { recursive: true, force: true });

    expect(registry.has('terse')).toBe(false);
    expect(registry.listSelectable()).toHaveLength(0);
  });

  /**
   * 0.2.66 — this used to assert the OPPOSITE for the in-package root, which was
   * scanned once at boot and cached for the process's life. That root is gone, and
   * with it the second cadence: every root the registry reads from disk is now
   * on-demand, so "ship a skill, restart the server" is no longer a step anyone has
   * to know about.
   */
  it('re-scans the global root too — there is no cached-at-boot root left', () => {
    const global = writeSkill(globalDir, 'b', 'user');
    const registry = SkillRegistry.load([{ dir: userDir, source: 'user' }, global], { rescanTtlMs: 0 });
    expect(registry.has('b')).toBe(true);

    fs.rmSync(path.join(globalDir, 'b'), { recursive: true, force: true });
    writeSkill(globalDir, 'b2', 'user');

    expect(registry.has('b')).toBe(false); // dropped with the directory
    expect(registry.has('b2')).toBe(true); // and the new one is seen without a restart
  });

  it('a project style added on disk overrides a same-slug global style', () => {
    const global = writeSkill(globalDir, 'terse', 'user', { body: 'GLOBAL body' });
    const registry = SkillRegistry.load([{ dir: userDir, source: 'user' }, global], { rescanTtlMs: 0 });
    expect(registry.resolve('terse').content).toContain('GLOBAL body');

    writeSkill(userDir, 'terse', 'user', { body: 'PROJECT body' });

    const resolved = registry.resolve('terse');
    expect(resolved.metadata.source).toBe('user');
    expect(resolved.content).toContain('PROJECT body');
  });

  it('coalesces a burst of reads within the TTL window into a single disk scan', () => {
    // Large window: the warm scan at load() wins; a style added immediately after is
    // not re-scanned until the window elapses, so repeated reads stay cheap.
    const registry = SkillRegistry.load([{ dir: userDir, source: 'user' }], { rescanTtlMs: 10_000 });
    expect(registry.has('terse')).toBe(false);

    writeSkill(userDir, 'terse', 'user');

    expect(registry.has('terse')).toBe(false); // coalesced — still serving the warm scan
    expect(registry.listSelectable()).toHaveLength(0);
  });
});
