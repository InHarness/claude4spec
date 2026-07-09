import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureGitignore } from './gitignore.js';

describe('ensureGitignore — M33 phase 2 defaults', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-gitignore-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('emits mcp.json + *.deprecated but NOT db.sqlite* or plugins/', () => {
    ensureGitignore(dir);
    const content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');

    expect(content).toContain('.claude4spec/mcp.json');
    expect(content).toContain('*.deprecated');
    // DB moved to the workspace slot — no longer ignored in the project.
    expect(content).not.toContain('db.sqlite');
    // Committed plugins must stay tracked — never auto-ignored.
    expect(content).not.toContain('.claude4spec/plugins');
  });

  it('is idempotent — a second run adds nothing', () => {
    ensureGitignore(dir);
    const first = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    ensureGitignore(dir);
    const second = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    expect(second).toBe(first);
  });
});

describe('ensureGitignore — 0.1.118 git.enabled bidirectional toggle', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-gitignore-git-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const read = (): string => fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');

  it('gitEnabled=false (default) gitignores the default briefs/patches dirs', () => {
    ensureGitignore(dir, { gitEnabled: false });
    const content = read();
    expect(content).toContain('.claude4spec/briefs/');
    expect(content).toContain('.claude4spec/patches/');
  });

  it('gitEnabled=true OMITS briefs/patches so they become committed', () => {
    ensureGitignore(dir, { gitEnabled: true });
    const content = read();
    expect(content).not.toContain('.claude4spec/briefs');
    expect(content).not.toContain('.claude4spec/patches');
    // Static patterns are unaffected by the master switch.
    expect(content).toContain('.claude4spec/mcp.json');
    expect(content).toContain('*.deprecated');
  });

  it('flipping false → true REMOVES the previously-added briefs/patches lines (the removal path)', () => {
    ensureGitignore(dir, { gitEnabled: false });
    expect(read()).toContain('.claude4spec/briefs/');

    ensureGitignore(dir, { gitEnabled: true });
    const content = read();
    expect(content).not.toContain('.claude4spec/briefs');
    expect(content).not.toContain('.claude4spec/patches');
  });

  it('flipping true → false RE-ADDS briefs/patches', () => {
    ensureGitignore(dir, { gitEnabled: true });
    expect(read()).not.toContain('.claude4spec/briefs');

    ensureGitignore(dir, { gitEnabled: false });
    const content = read();
    expect(content).toContain('.claude4spec/briefs/');
    expect(content).toContain('.claude4spec/patches/');
  });

  it('respects custom briefsDir/patchesDir values', () => {
    ensureGitignore(dir, { gitEnabled: false, briefsDir: 'docs/briefs', patchesDir: 'docs/patches' });
    const content = read();
    expect(content).toContain('docs/briefs/');
    expect(content).toContain('docs/patches/');
  });

  it('preserves user-authored content above the managed block across a toggle flip', () => {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n*.log\n');
    ensureGitignore(dir, { gitEnabled: false });
    expect(read()).toMatch(/^node_modules\/\n\*\.log\n\n# claude4spec \(auto-added\)/);

    ensureGitignore(dir, { gitEnabled: true });
    const content = read();
    expect(content).toContain('node_modules/');
    expect(content).toContain('*.log');
    expect(content).not.toContain('.claude4spec/briefs');
  });

  it('a broad user ignore of the whole .claude4spec/ dir is treated as already covering mcp.json/briefs/patches', () => {
    fs.writeFileSync(path.join(dir, '.gitignore'), '.claude4spec/\n');
    ensureGitignore(dir, { gitEnabled: false });
    const content = read();
    // mcp.json + default-location briefs/patches are covered by the broad
    // ignore and skipped; *.deprecated is unrelated to .claude4spec/ and is
    // still added.
    expect(content).not.toContain('.claude4spec/mcp.json');
    expect(content).not.toContain('.claude4spec/briefs');
    expect(content).not.toContain('.claude4spec/patches');
    expect(content).toContain('*.deprecated');
  });

  it('a second call with identical opts does not rewrite the file (mtime no-op)', () => {
    ensureGitignore(dir, { gitEnabled: false });
    const before = fs.statSync(path.join(dir, '.gitignore')).mtimeMs;
    // Force the clock forward enough to detect a spurious rewrite.
    fs.utimesSync(path.join(dir, '.gitignore'), new Date(0), new Date(0));
    ensureGitignore(dir, { gitEnabled: false });
    const after = fs.statSync(path.join(dir, '.gitignore')).mtimeMs;
    expect(after).toBe(new Date(0).getTime());
  });
});
