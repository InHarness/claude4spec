import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { writePatchFs } from './file-patch.js';
import { BriefFsError } from './types.js';

describe('writePatchFs', () => {
  let dir: string;
  let briefsDirAbs: string;
  let patchesDirAbs: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-patch-'));
    briefsDirAbs = path.join(dir, 'briefs');
    patchesDirAbs = path.join(dir, 'patches');
    fs.mkdirSync(briefsDirAbs, { recursive: true });
    fs.writeFileSync(
      path.join(briefsDirAbs, 'v0-1-to-v0-2.md'),
      matter.stringify('# Brief\n', { type: 'brief', to_release: '0.2', implemented: false }),
      'utf8',
    );
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a patch file with the expected frontmatter, filename slug, and body header', () => {
    const result = writePatchFs({
      briefsDirAbs,
      patchesDirAbs,
      briefRelPath: 'v0-1-to-v0-2.md',
      desc: 'Missing X detail',
      kind: 'missing',
      body: 'Explanation of the gap.',
      createdBy: 'claude-code',
    });

    expect(result.path).toBe('v0-1-to-v0-2-missing-x-detail.md');
    const written = fs.readFileSync(path.join(patchesDirAbs, result.path), 'utf8');
    const parsed = matter(written);
    expect(parsed.data).toMatchObject({
      type: 'patch',
      brief: 'v0-1-to-v0-2.md',
      patch_kind: 'missing',
      created_by: 'claude-code',
      status: 'awaiting',
    });
    expect(typeof parsed.data.created_at).toBe('string');
    expect(parsed.content).toContain('# Patch — Missing X detail');
    expect(parsed.content).toContain('Explanation of the gap.');
  });

  it('creates patchesDir lazily when it does not exist yet', () => {
    expect(fs.existsSync(patchesDirAbs)).toBe(false);
    writePatchFs({
      briefsDirAbs,
      patchesDirAbs,
      briefRelPath: 'v0-1-to-v0-2.md',
      desc: 'lazy mkdir',
      kind: 'drift',
      body: 'body',
      createdBy: 'test',
    });
    expect(fs.existsSync(patchesDirAbs)).toBe(true);
  });

  it('throws BRIEF_NOT_FOUND before writing anything when --brief does not exist', () => {
    expect(() =>
      writePatchFs({
        briefsDirAbs,
        patchesDirAbs,
        briefRelPath: 'nonexistent.md',
        desc: 'x',
        kind: 'drift',
        body: 'body',
        createdBy: 'test',
      }),
    ).toThrow(BriefFsError);
    expect(fs.existsSync(patchesDirAbs)).toBe(false);
  });

  it('throws PATCH_WRITE_FAILED when patchesDir is read-only', () => {
    if (process.platform === 'win32') return; // chmod semantics differ; skip
    fs.mkdirSync(patchesDirAbs, { recursive: true });
    fs.chmodSync(patchesDirAbs, 0o400);
    try {
      expect(() =>
        writePatchFs({
          briefsDirAbs,
          patchesDirAbs,
          briefRelPath: 'v0-1-to-v0-2.md',
          desc: 'readonly',
          kind: 'drift',
          body: 'body',
          createdBy: 'test',
        }),
      ).toThrow(BriefFsError);
    } finally {
      fs.chmodSync(patchesDirAbs, 0o700);
    }
  });
});
