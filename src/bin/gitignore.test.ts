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
