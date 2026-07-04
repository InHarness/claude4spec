import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { readBriefFs, assertSafeRelPath } from './read-brief.js';
import { BriefFsError } from './types.js';

describe('readBriefFs', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-briefs-'));
    fs.writeFileSync(
      path.join(dir, 'v0-1-to-v0-2.md'),
      matter.stringify('# Brief body\n', { type: 'brief', to_release: '0.2', implemented: false }),
      'utf8',
    );
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads frontmatter/body/content for an existing brief', () => {
    const result = readBriefFs(dir, 'v0-1-to-v0-2.md');
    expect(result.frontmatter.type).toBe('brief');
    expect(result.frontmatter.to_release).toBe('0.2');
    expect(result.body).toContain('# Brief body');
    expect(result.content).toContain('to_release');
  });

  it('throws BRIEF_NOT_FOUND with a hint listing available briefs', () => {
    try {
      readBriefFs(dir, 'nonexistent.md');
      expect.unreachable('expected readBriefFs to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BriefFsError);
      expect((err as BriefFsError).code).toBe('BRIEF_NOT_FOUND');
      expect((err as BriefFsError).hint).toContain('v0-1-to-v0-2.md');
    }
  });

  it('throws INVALID_ARGS for an absolute path', () => {
    expect(() => readBriefFs(dir, '/etc/passwd')).toThrow(BriefFsError);
    try {
      readBriefFs(dir, '/etc/passwd');
    } catch (err) {
      expect((err as BriefFsError).code).toBe('INVALID_ARGS');
    }
  });

  it('throws INVALID_ARGS for a path that escapes briefsDir via ..', () => {
    try {
      readBriefFs(dir, '../../etc/passwd');
      expect.unreachable('expected readBriefFs to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BriefFsError);
      expect((err as BriefFsError).code).toBe('INVALID_ARGS');
    }
  });

  it('assertSafeRelPath accepts a plain relative path and nested subdirs', () => {
    expect(() => assertSafeRelPath('v0-1-to-v0-2.md')).not.toThrow();
    expect(() => assertSafeRelPath('scoped/pages-to-v0-2.md')).not.toThrow();
  });
});
