import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError } from '../../bin/c4s/errors.js';
import { createPlugin, DEFAULT_TEMPLATE, redactUrlCredentials } from './create-plugin.js';

/**
 * M38 — the scaffolder, exercised against a LOCAL git repo used as the
 * template, so the whole suite stays network-free. `git clone <path>` takes the
 * same code path as `git clone <url>`.
 */

let cwd: string;
let templateRepo: string;

function git(args: string[], at: string): void {
  const res = spawnSync('git', args, { cwd: at, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-scaffold-cwd-'));
  templateRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-scaffold-tpl-'));

  fs.writeFileSync(path.join(templateRepo, 'package.json'), '{"name":"scaffold"}\n');
  fs.writeFileSync(path.join(templateRepo, 'README.md'), '# scaffold\n');
  fs.mkdirSync(path.join(templateRepo, 'src'));
  fs.writeFileSync(path.join(templateRepo, 'src', 'index.ts'), 'export {};\n');

  git(['init', '-q', '-b', 'main'], templateRepo);
  git(['config', 'user.email', 'test@example.com'], templateRepo);
  git(['config', 'user.name', 'test'], templateRepo);
  git(['add', '-A'], templateRepo);
  git(['commit', '-qm', 'initial'], templateRepo);
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.rmSync(templateRepo, { recursive: true, force: true });
});

function expectCliError(fn: () => unknown, code: string): CliError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe(code);
    return err as CliError;
  }
  throw new Error(`expected a CliError('${code}'), but nothing was thrown`);
}

describe('M38 createPlugin', () => {
  it('expands the template into a fresh directory without carrying git history', () => {
    const result = createPlugin(
      { targetDir: 'my-plugin', template: templateRepo, install: false },
      cwd,
    );

    const abs = path.join(cwd, 'my-plugin');
    expect(result).toMatchObject({
      targetDir: abs,
      template: templateRepo,
      branch: 'main',
      // 0.2.2: relative POSIX paths, sorted — M22 `writeFileSet` parity, so the
      // caller learns WHICH files landed, not merely how many.
      filesWritten: ['README.md', 'package.json', 'src/index.ts'],
      installed: false,
    });
    expect(fs.readFileSync(path.join(abs, 'src', 'index.ts'), 'utf8')).toBe('export {};\n');
    // A fresh starter must not inherit the template's commits.
    expect(fs.existsSync(path.join(abs, '.git'))).toBe(false);
  });

  it('fetches the requested revision and reports it back', () => {
    git(['checkout', '-q', '-b', 'v2'], templateRepo);
    fs.writeFileSync(path.join(templateRepo, 'EXTRA.md'), 'v2\n');
    git(['add', '-A'], templateRepo);
    git(['commit', '-qm', 'v2'], templateRepo);
    git(['checkout', '-q', 'main'], templateRepo);

    const result = createPlugin(
      { targetDir: 'p', template: templateRepo, branch: 'v2', install: false },
      cwd,
    );

    expect(result.branch).toBe('v2');
    expect(result.filesWritten).toEqual(['EXTRA.md', 'README.md', 'package.json', 'src/index.ts']);
    expect(fs.existsSync(path.join(cwd, 'p', 'EXTRA.md'))).toBe(true);
  });

  it('rejects a multi-segment or escaping <target-dir> before writing or fetching anything', () => {
    for (const bad of ['a/b', '..', '', '   ', path.join('..', 'evil')]) {
      expectCliError(() => createPlugin({ targetDir: bad, template: templateRepo }, cwd), 'INVALID_TARGET');
    }
    // Nothing was created anywhere — validation runs first.
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  it('refuses a non-empty existing directory without --force, leaving it untouched', () => {
    const abs = path.join(cwd, 'taken');
    fs.mkdirSync(abs);
    fs.writeFileSync(path.join(abs, 'mine.txt'), 'keep me\n');

    const err = expectCliError(
      () => createPlugin({ targetDir: 'taken', template: templateRepo, install: false }, cwd),
      'TARGET_EXISTS',
    );
    expect(err.hint).toMatch(/--force/);
    expect(fs.readdirSync(abs)).toEqual(['mine.txt']);
  });

  it('proceeds into a non-empty directory with --force, keeping what was already there', () => {
    const abs = path.join(cwd, 'taken');
    fs.mkdirSync(abs);
    fs.writeFileSync(path.join(abs, 'mine.txt'), 'keep me\n');

    const result = createPlugin(
      { targetDir: 'taken', template: templateRepo, force: true, install: false },
      cwd,
    );

    // Reports only what the scaffold wrote — the operator's pre-existing
    // `mine.txt` is untouched and is NOT claimed as written by this run.
    expect(result.filesWritten).toEqual(['README.md', 'package.json', 'src/index.ts']);
    expect(fs.readFileSync(path.join(abs, 'mine.txt'), 'utf8')).toBe('keep me\n');
    expect(fs.existsSync(path.join(abs, 'README.md'))).toBe(true);
  });

  it('rolls the created directory back when the fetch fails', () => {
    const err = expectCliError(
      () =>
        createPlugin(
          { targetDir: 'gone', template: path.join(cwd, 'no-such-repo'), install: false },
          cwd,
        ),
      'TEMPLATE_FETCH_FAILED',
    );

    expect(err.message).toContain('no-such-repo');
    expect(fs.existsSync(path.join(cwd, 'gone'))).toBe(false);
  });

  it('names the missed revision when the branch does not exist', () => {
    const err = expectCliError(
      () =>
        createPlugin(
          { targetDir: 'p', template: templateRepo, branch: 'nope', install: false },
          cwd,
        ),
      'TEMPLATE_FETCH_FAILED',
    );

    expect(err.message).toContain("revision 'nope'");
    expect(fs.existsSync(path.join(cwd, 'p'))).toBe(false);
  });

  it('under --force, a failed fetch removes only what this run wrote', () => {
    const abs = path.join(cwd, 'taken');
    fs.mkdirSync(abs);
    fs.writeFileSync(path.join(abs, 'mine.txt'), 'keep me\n');

    expectCliError(
      () =>
        createPlugin(
          { targetDir: 'taken', template: path.join(cwd, 'no-such-repo'), force: true },
          cwd,
        ),
      'TEMPLATE_FETCH_FAILED',
    );

    expect(fs.readFileSync(path.join(abs, 'mine.txt'), 'utf8')).toBe('keep me\n');
  });

  it('under --force, a failure MID-COPY never deletes pre-existing files', () => {
    // The regression this guards: recording overwritten files in the rollback
    // ledger made a mid-copy failure delete the operator's own files. Rollback
    // may only remove what the run itself created.
    const abs = path.join(cwd, 'taken');
    fs.mkdirSync(abs);
    // Not in the template, so the expansion never touches it: it must come out
    // byte-identical.
    fs.writeFileSync(path.join(abs, 'KEEP_ME.txt'), 'MY PRECIOUS NOTES\n');
    // In the template, so `--force` legitimately overwrites it — but rollback
    // must not then DELETE it, which is what recording overwrites in the ledger
    // used to do.
    fs.writeFileSync(path.join(abs, 'README.md'), 'mine\n');
    // `src` exists as a FILE, so copying the template's `src/` directory into
    // it fails part-way through the expansion.
    fs.writeFileSync(path.join(abs, 'src'), 'not a directory\n');

    expectCliError(
      () => createPlugin({ targetDir: 'taken', template: templateRepo, force: true, install: false }, cwd),
      'SCAFFOLD_WRITE_FAILED',
    );

    expect(fs.existsSync(abs), 'a pre-existing target dir is never removed').toBe(true);
    expect(fs.readFileSync(path.join(abs, 'KEEP_ME.txt'), 'utf8')).toBe('MY PRECIOUS NOTES\n');
    expect(fs.existsSync(path.join(abs, 'README.md')), 'overwritten ≠ deleted').toBe(true);
    // What the run itself created is gone.
    expect(fs.existsSync(path.join(abs, 'package.json'))).toBe(false);
  });

  it('reports a target that exists as a FILE as TARGET_EXISTS, not a raw ENOTDIR', () => {
    fs.writeFileSync(path.join(cwd, 'notes'), 'a file, not a directory\n');
    const err = expectCliError(
      () => createPlugin({ targetDir: 'notes', template: templateRepo, force: true, install: false }, cwd),
      'TARGET_EXISTS',
    );
    expect(err.message).toMatch(/not a directory/);
    // Untouched — the guard runs before anything is fetched or written.
    expect(fs.readFileSync(path.join(cwd, 'notes'), 'utf8')).toBe('a file, not a directory\n');
  });

  it('never echoes credentials embedded in the template URL', () => {
    const secret = 'ghp_exampletoken1234567890';
    const err = expectCliError(
      () =>
        createPlugin(
          {
            targetDir: 'p',
            template: `https://x-access-token:${secret}@example.invalid/private.git`,
            install: false,
          },
          cwd,
        ),
      'TEMPLATE_FETCH_FAILED',
    );
    expect(`${err.message} ${err.hint ?? ''}`).not.toContain(secret);
    expect(err.message).toContain('***@example.invalid');
  });

  it('redacts userinfo from arbitrary text', () => {
    expect(redactUrlCredentials('https://user:pw@host/x')).toBe('https://***@host/x');
    expect(redactUrlCredentials('git clone https://t0ken@github.com/a/b failed')).toBe(
      'git clone https://***@github.com/a/b failed',
    );
    // No userinfo → untouched.
    expect(redactUrlCredentials('https://github.com/a/b')).toBe('https://github.com/a/b');
  });

  it('leaves no temp clone behind on the happy path', () => {
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('c4s-plugin-'));
    createPlugin({ targetDir: 'p', template: templateRepo, install: false }, cwd);
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('c4s-plugin-'));
    expect(after).toEqual(before);
  });

  it('defaults the template to the published scaffold repo', () => {
    expect(DEFAULT_TEMPLATE).toBe('https://github.com/InHarness/c4s-plugin-scaffold');
  });
});
