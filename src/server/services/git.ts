/**
 * M28 Git Sync — best-effort mirroring of claude4spec actions into the user's
 * git repository. This service OWNS every `git` subprocess call (the only git
 * shell-out in the server). All methods are best-effort: a missing/broken git,
 * a missing repo, or a failed command never throws to the caller — it resolves
 * to a non-throwing result shape.
 *
 * `detect()` answers "is `pagesDir` inside a worktree, and what does it look
 * like". `commit()` / `push()` perform the two sync actions. `commitOnRelease()`
 * / `pushOnPush()` are the gated entry points the hooks call: they read the
 * (hot-reloaded) config flag, detect the repo, and either act or return `null`
 * (flag off OR no repo).
 *
 * Spec: brief 0-1-37-to-0-1-38.md (M28).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { configPath, readConfig } from '../config.js';
import type {
  GitCommitResult,
  GitPushResult,
  GitStatusResponse,
} from '../../shared/git.js';

const pexec = promisify(execFile);

const NOT_DETECTED: GitStatusResponse = {
  detected: false,
  rootPath: null,
  remoteUrl: null,
  branch: null,
  isDirty: false,
};

export class GitService {
  /**
   * @param cwd       project root (holds `.claude4spec/config.json`).
   * @param pagesPath absolute path to the pages directory — the probe location
   *                  for repo detection (a release may live in a sub-worktree).
   */
  constructor(
    private cwd: string,
    private pagesPath: string,
  ) {}

  /** Run `git <args>` in `dir`. Throws on non-zero exit or a missing binary. */
  private async git(args: string[], dir: string): Promise<{ stdout: string; stderr: string }> {
    return pexec('git', args, { cwd: dir });
  }

  /**
   * Probe `pagesDir` for a git worktree. Never throws — git missing (ENOENT),
   * no repo, or `pagesDir` outside any worktree (exit 128) all map to
   * `detected: false`.
   */
  async detect(): Promise<GitStatusResponse> {
    let rootPath: string;
    try {
      const { stdout } = await this.git(['rev-parse', '--show-toplevel'], this.pagesPath);
      rootPath = stdout.trim();
      if (!rootPath) return NOT_DETECTED;
    } catch {
      return NOT_DETECTED;
    }

    // Inside a worktree — the remaining probes are individually best-effort.
    const remoteUrl = await this.git(['remote', 'get-url', 'origin'], rootPath)
      .then((r) => r.stdout.trim() || null)
      .catch(() => null);

    const branch = await this.git(['rev-parse', '--abbrev-ref', 'HEAD'], rootPath)
      .then((r) => {
        const b = r.stdout.trim();
        // Detached HEAD reports the literal "HEAD" — surface as no branch.
        return b && b !== 'HEAD' ? b : null;
      })
      .catch(() => null);

    const isDirty = await this.git(['status', '--porcelain'], rootPath)
      .then((r) => r.stdout.trim().length > 0)
      .catch(() => false);

    return { detected: true, rootPath, remoteUrl, branch, isDirty };
  }

  /**
   * Stage `pagesDir` + `config.json` and commit. Assumes a repo is detected
   * (callers gate via `commitOnRelease`). Returns `'skipped'` on detached HEAD,
   * `'nothing-to-commit'` when nothing is staged, `'error'` on any git failure.
   */
  async commit(opts: { name: string; description: string }): Promise<GitCommitResult> {
    const status = await this.detect();
    if (!status.detected || !status.rootPath) return { status: 'skipped' };
    if (!status.branch) return { status: 'skipped', message: 'detached HEAD' };
    const root = status.rootPath;

    // Canonicalize staging targets. pagesPath / configPath may be reached
    // through a symlink (e.g. `.claude/skills/specyfikacja` → another repo's
    // worktree). `git add` matches pathspecs lexically against the real worktree
    // root, so an unresolved symlink path reads as "outside repository". Resolve
    // to real paths and keep only those that actually live inside `root`.
    const targets: string[] = [];
    for (const p of [this.pagesPath, configPath(this.cwd)]) {
      let real: string;
      try {
        real = fs.realpathSync(p);
      } catch {
        continue; // missing path — nothing to stage from it
      }
      const rel = path.relative(root, real);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) targets.push(real);
    }
    if (targets.length === 0) {
      return {
        status: 'skipped',
        message: 'pages directory / config.json are outside the detected repository',
      };
    }

    try {
      await this.git(['add', '--', ...targets], root);
    } catch (err) {
      return { status: 'error', message: errMessage(err) };
    }

    // `git diff --cached --quiet` exits 0 when nothing is staged, 1 otherwise.
    try {
      await this.git(['diff', '--cached', '--quiet'], root);
      return { status: 'nothing-to-commit' };
    } catch {
      // non-zero ⇒ there are staged changes; fall through to commit.
    }

    const message = opts.description ? `${opts.name}\n\n${opts.description}` : opts.name;
    try {
      await this.git(['commit', '-m', message], root);
      return { status: 'committed' };
    } catch (err) {
      return { status: 'error', message: errMessage(err) };
    }
  }

  /**
   * Push the current branch to its upstream. Assumes a repo is detected.
   * `'nothing-to-push'` when git reports "Everything up-to-date", `'skipped'`
   * on detached HEAD, `'error'` on a missing upstream or any other failure.
   */
  async push(): Promise<GitPushResult> {
    const status = await this.detect();
    if (!status.detected || !status.rootPath) return { status: 'skipped' };
    if (!status.branch) return { status: 'skipped', message: 'detached HEAD' };

    try {
      const { stdout, stderr } = await this.git(['push'], status.rootPath);
      if (/Everything up-to-date/i.test(`${stdout}\n${stderr}`)) {
        return { status: 'nothing-to-push' };
      }
      return { status: 'pushed' };
    } catch (err) {
      return { status: 'error', message: errMessage(err) };
    }
  }

  /**
   * Gated commit hook. `null` when commit-sync is off OR no repo detected;
   * otherwise the `commit()` result. Reads config per-call (hot-reload).
   */
  async commitOnRelease(release: { name: string; description: string }): Promise<GitCommitResult | null> {
    const config = readConfig(this.cwd);
    if (!config.git?.syncCommitOnRelease) return null;
    const status = await this.detect();
    if (!status.detected) return null;
    return this.commit(release);
  }

  /**
   * Gated push hook. `null` when push-sync is off OR no repo detected;
   * otherwise the `push()` result. Reads config per-call (hot-reload).
   */
  async pushOnPush(): Promise<GitPushResult | null> {
    const config = readConfig(this.cwd);
    if (!config.git?.syncPushOnPush) return null;
    const status = await this.detect();
    if (!status.detected) return null;
    return this.push();
  }
}

function errMessage(err: unknown): string {
  // execFile rejections carry the combined stderr; prefer it over the generic
  // "Command failed" wrapper for a useful warning toast.
  const stderr = (err as { stderr?: string })?.stderr?.trim();
  if (stderr) return stderr;
  return err instanceof Error ? err.message : String(err);
}
