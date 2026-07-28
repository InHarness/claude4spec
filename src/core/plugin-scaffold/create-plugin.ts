import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../../bin/c4s/errors.js';

/**
 * M38 Plugin Scaffolding — the domain core behind `c4s create-plugin`.
 *
 * Bootstraps a new plugin project in a fresh subdirectory of the CWD from a
 * remote git template, `create-react-app` style. The CLI contribution in
 * `src/bin/c4s/commands/create-plugin.ts` only parses flags and delegates here;
 * every rule below (target validation, fetch, expansion, rollback, install)
 * lives in this module.
 *
 * Deliberate v1 non-goals: no trust verification for a foreign `--template`
 * (parity with the project-local plugin trust model, M31 `trust-plugins` — the
 * operator owns that decision); no registration of the created plugin anywhere
 * (no workspace entry, no `config.entities`); no interactive mode (flags only,
 * so the command stays scriptable and agent-friendly); no `eject`/`upgrade`.
 *
 * Environment: network access and `git` on `$PATH`, plus `npm` unless the
 * install step is skipped.
 */

/** Scaffold source repo when `--template` is not given. */
export const DEFAULT_TEMPLATE = 'https://github.com/InHarness/c4s-plugin-scaffold';

export interface CreatePluginInput {
  /** Name of the new subdirectory in the CWD — a single path segment. */
  targetDir: string;
  /** Git URL of the scaffold repo. */
  template: string;
  /** Branch or tag to fetch; defaults to the repo's default branch. */
  branch?: string;
  /** Continue when the target directory already exists / is non-empty. */
  force?: boolean;
  /** Run `npm install` after expansion. Defaults to true. */
  install?: boolean;
}

export interface CreatePluginResult {
  targetDir: string;
  template: string;
  /** The revision actually used — resolved from the clone when `branch` was omitted. */
  branch: string;
  filesWritten: number;
  installed: boolean;
}

/**
 * Tracks what THIS run put on disk, so a rollback removes exactly that and
 * nothing else. Same discipline as M27's `rollbackClone`: with `--force` over a
 * pre-existing directory, files that were already there are never touched.
 */
interface WriteLedger {
  /** True when this run created the target directory itself. */
  createdTargetDir: boolean;
  /** Absolute paths of files written by this run, in creation order. */
  files: string[];
  /** Absolute paths of directories created by this run, in creation order. */
  dirs: string[];
}

export function createPlugin(input: CreatePluginInput, cwd = process.cwd()): CreatePluginResult {
  const { template, branch, force = false, install = true } = input;

  // 1. Validate the target name BEFORE any write and before any fetch.
  const targetName = validateTargetDir(input.targetDir, cwd);
  const abs = path.resolve(cwd, targetName);

  // 2. Target state — a non-empty directory needs `--force`. Nothing has been
  //    written or fetched at this point, so there is nothing to roll back.
  const existed = fs.existsSync(abs);
  if (existed && !force && !isEmptyDir(abs)) {
    throw new CliError(
      'TARGET_EXISTS',
      `directory '${targetName}' already exists and is not empty`,
      'use a different name or pass --force',
    );
  }

  const ledger: WriteLedger = { createdTargetDir: !existed, files: [], dirs: [] };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-plugin-'));

  try {
    // 3. Fetch the scaffold, history-free: the starter must not inherit the
    //    template's commits, so `.git` is dropped before anything is expanded.
    const resolvedBranch = fetchTemplate(template, branch, tmp);
    fs.rmSync(path.join(tmp, '.git'), { recursive: true, force: true });

    // 4. Expand into the target directory.
    if (!existed) {
      fs.mkdirSync(abs, { recursive: true });
    }
    const filesWritten = copyTree(tmp, abs, ledger);

    // 5. Install — non-fatal for the files on disk: an `npm install` failure
    //    leaves everything in place so a retry needs no refetch.
    let installed = false;
    if (install) {
      runInstall(abs);
      installed = true;
    }

    return { targetDir: abs, template, branch: resolvedBranch, filesWritten, installed };
  } catch (err) {
    // Steps 1–4 are all-or-nothing; INSTALL_FAILED is explicitly not.
    if (!(err instanceof CliError) || err.code !== 'INSTALL_FAILED') {
      rollback(abs, ledger);
    }
    throw err;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * `<target-dir>` must name a direct child of the CWD: a single path segment,
 * no separators, no escaping sequences. Rejected as `INVALID_TARGET` before any
 * side effect.
 */
function validateTargetDir(raw: string, cwd: string): string {
  const name = (raw ?? '').trim();
  if (!name) {
    throw new CliError('INVALID_TARGET', '<target-dir> is required and must not be empty');
  }
  if (name.includes('/') || name.includes(path.sep) || name.includes('\\')) {
    throw new CliError(
      'INVALID_TARGET',
      `<target-dir> must be a single path segment, got '${name}'`,
      'pass just the new directory name, e.g. `c4s create-plugin my-plugin`',
    );
  }
  if (name === '.' || name === '..') {
    throw new CliError('INVALID_TARGET', `<target-dir> must name a new directory, got '${name}'`);
  }
  const abs = path.resolve(cwd, name);
  if (path.dirname(abs) !== path.resolve(cwd)) {
    throw new CliError(
      'INVALID_TARGET',
      `<target-dir> must stay inside the current working directory, got '${name}'`,
    );
  }
  return name;
}

function isEmptyDir(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}

/**
 * Shallow-clones the template into `dest` and returns the revision used. A
 * missing `git`, an unreachable repo and a non-existent branch/tag all surface
 * as `TEMPLATE_FETCH_FAILED`, with the missed revision named in the message.
 */
function fetchTemplate(template: string, branch: string | undefined, dest: string): string {
  const args = ['clone', '--depth', '1', '--single-branch'];
  if (branch) args.push('--branch', branch);
  args.push(template, dest);

  const clone = spawnSync('git', args, { encoding: 'utf8' });
  if (clone.error && (clone.error as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new CliError(
      'TEMPLATE_FETCH_FAILED',
      'git is not available on $PATH',
      'install git, or run with --template pointing at a reachable clone',
    );
  }
  if (clone.status !== 0) {
    const stderr = (clone.stderr ?? '').trim();
    const where = branch ? `${template} at revision '${branch}'` : template;
    throw new CliError(
      'TEMPLATE_FETCH_FAILED',
      `failed to fetch scaffold from ${where}${stderr ? `: ${stderr}` : ''}`,
      branch
        ? `check that branch/tag '${branch}' exists in ${template}`
        : 'check the template URL, your network access and repository permissions',
    );
  }

  if (branch) return branch;
  const head = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: dest,
    encoding: 'utf8',
  });
  const resolved = (head.stdout ?? '').trim();
  return head.status === 0 && resolved ? resolved : 'HEAD';
}

/** Recursively copies `from` into `to`, recording every path this run creates. */
function copyTree(from: string, to: string, ledger: WriteLedger): number {
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      if (!fs.existsSync(dst)) {
        fs.mkdirSync(dst, { recursive: true });
        ledger.dirs.push(dst);
      }
      count += copyTree(src, dst, ledger);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dst);
      ledger.files.push(dst);
      count++;
    }
    // Symlinks and other special entries are skipped: a scaffold is plain files.
  }
  return count;
}

/**
 * All-or-nothing for steps 1–4. A directory this run created goes away whole;
 * over a pre-existing directory (`--force`) only this run's own writes are
 * undone, so the operator's files survive a failed scaffold.
 */
function rollback(abs: string, ledger: WriteLedger): void {
  if (ledger.createdTargetDir) {
    fs.rmSync(abs, { recursive: true, force: true });
    return;
  }
  for (const file of ledger.files) {
    fs.rmSync(file, { force: true });
  }
  // Deepest-first, so a directory is empty by the time it is removed; `rmdir`
  // on a directory that gained other content is a no-op we swallow.
  for (const dir of [...ledger.dirs].reverse()) {
    try {
      fs.rmdirSync(dir);
    } catch {
      /* not empty — it holds pre-existing content, leave it */
    }
  }
}

function runInstall(cwd: string): void {
  const res = spawnSync('npm', ['install'], {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new CliError(
      'INSTALL_FAILED',
      'npm is not available on $PATH',
      `the scaffold files are in place — run \`npm install\` in ${cwd} yourself`,
    );
  }
  if (res.status !== 0) {
    throw new CliError(
      'INSTALL_FAILED',
      `npm install failed in ${cwd} (exit ${String(res.status)})`,
      `the scaffold files are in place — run \`npm install\` in ${cwd} yourself, or re-run with --no-install`,
    );
  }
}
