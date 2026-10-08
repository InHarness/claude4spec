import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { writePatchFs } from './create-patch.js';
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

  it('[ac:ac-plik-patcha-frontmatter-type-patch-br] writes a patch file with the expected frontmatter, filename slug, and body header', async () => {
    const result = await writePatchFs({
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
      applied: false,
    });
    expect(typeof parsed.data.created_at).toBe('string');
    expect(parsed.content).toContain('# Patch — Missing X detail');
    expect(parsed.content).toContain('Explanation of the gap.');
  });

  it('refuses a brief outside the briefs file map (a nested file) as BRIEF_NOT_FOUND, writing nothing', async () => {
    fs.mkdirSync(path.join(briefsDirAbs, 'scoped-a'), { recursive: true });
    fs.writeFileSync(
      path.join(briefsDirAbs, 'scoped-a', 'foo.md'),
      matter.stringify('# Brief A\n', { type: 'brief', to_release: '0.2', implemented: false }),
      'utf8',
    );

    const err = await writePatchFs({
      briefsDirAbs,
      patchesDirAbs,
      briefRelPath: 'scoped-a/foo.md',
      desc: 'typo fix',
      kind: 'drift',
      body: 'body A',
      createdBy: 'test',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BriefFsError);
    expect((err as BriefFsError).code).toBe('BRIEF_NOT_FOUND');
    expect(fs.existsSync(patchesDirAbs)).toBe(false);
  });

  it('[ac:ac-brak-katalogu-patchesdir-nie-jest-ble] creates patchesDir lazily when it does not exist yet', async () => {
    expect(fs.existsSync(patchesDirAbs)).toBe(false);
    await writePatchFs({
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

  it('throws BRIEF_NOT_FOUND before writing anything when --brief does not exist', async () => {
    await expect(
      writePatchFs({
        briefsDirAbs,
        patchesDirAbs,
        briefRelPath: 'nonexistent.md',
        desc: 'x',
        kind: 'drift',
        body: 'body',
        createdBy: 'test',
      }),
    ).rejects.toThrow(BriefFsError);
    expect(fs.existsSync(patchesDirAbs)).toBe(false);
  });

  it('throws PATCH_WRITE_FAILED when patchesDir is read-only', async () => {
    if (process.platform === 'win32') return; // chmod semantics differ; skip
    fs.mkdirSync(patchesDirAbs, { recursive: true });
    fs.chmodSync(patchesDirAbs, 0o400);
    try {
      await expect(
        writePatchFs({
          briefsDirAbs,
          patchesDirAbs,
          briefRelPath: 'v0-1-to-v0-2.md',
          desc: 'readonly',
          kind: 'drift',
          body: 'body',
          createdBy: 'test',
        }),
      ).rejects.toThrow(BriefFsError);
    } finally {
      fs.chmodSync(patchesDirAbs, 0o700);
    }
  });
});
