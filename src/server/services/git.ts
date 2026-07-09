/**
 * M28 Git Sync — best-effort mirroring of claude4spec actions into the user's
 * git repository. This service OWNS every `git` subprocess call (the only git
 * shell-out in the server). All methods are best-effort: a missing/broken git,
 * a missing repo, or a failed command never throws to the caller — it resolves
 * to a non-throwing result shape.
 *
 * `detect()` answers "is any releasable root inside a worktree, and what does it
 * look like". `commit()` / `push()` perform the two sync actions. `commitOnRelease()`
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
  GitAheadBehindStatus,
  GitCommitResult,
  GitPushResult,
  GitRefDiff,
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
  /** Releasable root dirs resolved to absolute paths (probe locations). */
  private readonly releasableRootDirs: string[];

  /**
   * @param cwd                project root (holds `.claude4spec/config.json`).
   * @param releasableRootDirs dirs of the releasable roots (absolute or
   *                           cwd-relative) — the probe locations for repo
   *                           detection (a release may live in a sub-worktree).
   */
  constructor(
    private cwd: string,
    releasableRootDirs: string[],
  ) {
    this.releasableRootDirs = releasableRootDirs.map((d) => path.resolve(cwd, d));
  }

  /** Run `git <args>` in `dir`. Throws on non-zero exit or a missing binary. */
  private async git(args: string[], dir: string): Promise<{ stdout: string; stderr: string }> {
    return pexec('git', args, { cwd: dir });
  }

  /**
   * Probe the releasable roots for a git worktree. Detected when ANY releasable
   * root is inside a worktree; the first such root wins. Never throws — git
   * missing (ENOENT), no repo, or a root outside any worktree (exit 128) all map
   * to `detected: false`.
   */
  async detect(): Promise<GitStatusResponse> {
    let rootPath: string | null = null;
    for (const dir of this.releasableRootDirs) {
      let real: string;
      try {
        real = fs.realpathSync(dir);
      } catch {
        continue; // missing path — cannot probe from it
      }
      try {
        const { stdout } = await this.git(['rev-parse', '--show-toplevel'], real);
        const top = stdout.trim();
        if (top) {
          rootPath = top;
          break;
        }
      } catch {
        // not inside a worktree (or git missing) — try the next root
      }
    }
    if (!rootPath) return NOT_DETECTED;

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
   * Stage every releasable root dir + `config.json` and commit. Assumes a repo
   * is detected (callers gate via `commitOnRelease`). Returns `'skipped'` on
   * detached HEAD, `'nothing-to-commit'` when nothing is staged, `'error'` on
   * any git failure.
   */
  async commit(opts: { name: string; description: string }): Promise<GitCommitResult> {
    const status = await this.detect();
    if (!status.detected || !status.rootPath) return { status: 'skipped' };
    if (!status.branch) return { status: 'skipped', message: 'detached HEAD' };
    const root = status.rootPath;

    // Canonicalize staging targets. Root dirs / configPath may be reached
    // through a symlink (e.g. `.claude/skills/specyfikacja` → another repo's
    // worktree). `git add` matches pathspecs lexically against the real worktree
    // root, so an unresolved symlink path reads as "outside repository". Resolve
    // to real paths and keep only those that actually live inside `root`.
    //
    // Stage every releasable root dir; briefsDir/patchesDir are NEVER releasable
    // and so are never staged. M29: also stage the committed entity store
    // (<entitiesDir> contains the entity JSON files + tags.json — the source of
    // truth). db.sqlite is gitignored, so the whole dir can be staged safely.
    // 0.1.118: also stage releasesDir so the new release's identity file lands
    // in this same commit as its anchor (for resolveReleaseCommit later).
    const bootConfig = readConfig(this.cwd);
    const entitiesPath = path.resolve(this.cwd, bootConfig.entitiesDir);
    const releasesPath = path.resolve(this.cwd, bootConfig.releasesDir);
    const targets: string[] = [];
    for (const p of [...this.releasableRootDirs, configPath(this.cwd), entitiesPath, releasesPath]) {
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
        message: 'releasable roots / config.json are outside the detected repository',
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
   * Gated commit hook. `null` when the git master switch is off, commit-sync
   * is off, no repo is detected, or the detected repo has no branch (detached
   * HEAD); otherwise the `commit()` result. `enabled` is checked FIRST so a
   * disabled project never pays for the `detect()` subprocess round-trip.
   * Reads config per-call (hot-reload).
   */
  async commitOnRelease(release: { name: string; description: string }): Promise<GitCommitResult | null> {
    const config = readConfig(this.cwd);
    if (!config.git?.enabled || !config.git?.syncCommitOnRelease) return null;
    const status = await this.detect();
    if (!status.detected || !status.branch) return null;
    return this.commit(release);
  }

  /**
   * Gated push hook. `null` when the git master switch is off, push-sync is
   * off, no repo is detected, or the detected repo has no branch (detached
   * HEAD); otherwise the `push()` result. Reads config per-call (hot-reload).
   */
  async pushOnPush(): Promise<GitPushResult | null> {
    const config = readConfig(this.cwd);
    if (!config.git?.enabled || !config.git?.syncPushOnPush) return null;
    const status = await this.detect();
    if (!status.detected || !status.branch) return null;
    return this.push();
  }

  /**
   * 0.1.118 read-only: SHA of the commit that first ADDED `absPath` (`git log
   * --diff-filter=A -1 --format=%H -- <path>`) — used to anchor a release's
   * identity in git history (there are no tags/stored gitSha). `null` when git
   * is disabled, no repo is detected, `absPath` is outside the repo, or the
   * file has never been added (e.g. `syncCommitOnRelease` was off when it was
   * created — B3, a known open edge). Never throws.
   */
  async resolveReleaseCommit(absPath: string): Promise<string | null> {
    const config = readConfig(this.cwd);
    if (!config.git?.enabled) return null;
    const status = await this.detect();
    if (!status.detected || !status.rootPath) return null;
    let real: string;
    try {
      real = fs.realpathSync(absPath);
    } catch {
      return null;
    }
    const rel = path.relative(status.rootPath, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    try {
      const { stdout } = await this.git(
        ['log', '--diff-filter=A', '-1', '--format=%H', '--', real],
        status.rootPath,
      );
      const sha = stdout.trim();
      return sha || null;
    } catch {
      return null;
    }
  }

  /**
   * 0.1.118 read-only: file-level diff between two commits, scoped to
   * `paths` (releasable roots + entitiesDir + releasesDir, per the caller).
   * Uses `--name-status` (not the brief's literal `git diff <a>..<b>`, which
   * alone does not produce a parseable `{path, status}` shape). Renames/copies
   * are flattened into a delete(old)+create(new) pair to keep the existing
   * create/update/delete vocabulary intact downstream. Never throws — `null`
   * when git is disabled or no repo is detected; an empty `{files: []}` when
   * none of `paths` resolve inside the repo.
   */
  async diffRefs(shaA: string, shaB: string, paths: string[]): Promise<GitRefDiff | null> {
    const config = readConfig(this.cwd);
    if (!config.git?.enabled) return null;
    const status = await this.detect();
    if (!status.detected || !status.rootPath) return null;
    const root = status.rootPath;

    const targets: string[] = [];
    for (const p of paths) {
      let real: string;
      try {
        real = fs.realpathSync(p);
      } catch {
        continue;
      }
      const rel = path.relative(root, real);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) targets.push(real);
    }
    if (targets.length === 0) return { files: [] };

    try {
      const { stdout } = await this.git(
        ['diff', '--name-status', `${shaA}..${shaB}`, '--', ...targets],
        root,
      );
      const files: GitRefDiff['files'] = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split('\t');
        const code = parts[0]!;
        const letter = code[0];
        if (letter === 'R' || letter === 'C') {
          // Rename/copy: two paths on one line — flatten to delete(old)+create(new).
          const oldPath = parts[1];
          const newPath = parts[2];
          // `git diff --name-status` reports paths relative to the repo ROOT
          // (which may sit above `cwd` in a monorepo) — resolve to absolute so
          // callers never have to re-derive `status.rootPath` themselves.
          if (oldPath) files.push({ path: path.join(root, oldPath), status: 'D' });
          if (newPath) files.push({ path: path.join(root, newPath), status: 'A' });
        } else if (letter === 'A' || letter === 'M' || letter === 'D') {
          const filePath = parts[1];
          if (filePath) files.push({ path: path.join(root, filePath), status: letter });
        }
      }
      return { files };
    } catch (err) {
      console.error('[git] diffRefs failed:', errMessage(err));
      return null;
    }
  }

  /**
   * 0.1.118 read-only: HEAD status vs. upstream. Reuses `detect()`'s
   * branch/dirty rather than re-probing. `null` when git is disabled, no repo
   * is detected, or the branch is detached (no branch to compare). A non-null
   * result with `ahead`/`behind` both `null` means a repo + branch exist but
   * no upstream is configured — distinct from "no repo at all".
   */
  async statusAheadBehind(): Promise<GitAheadBehindStatus | null> {
    const config = readConfig(this.cwd);
    if (!config.git?.enabled) return null;
    const status = await this.detect();
    if (!status.detected || !status.rootPath || !status.branch) return null;

    try {
      const { stdout } = await this.git(
        ['rev-list', '--left-right', '--count', `${status.branch}...@{upstream}`],
        status.rootPath,
      );
      const [aheadStr, behindStr] = stdout.trim().split(/\s+/);
      const ahead = aheadStr !== undefined ? Number(aheadStr) : NaN;
      const behind = behindStr !== undefined ? Number(behindStr) : NaN;
      return {
        branch: status.branch,
        isDirty: status.isDirty,
        ahead: Number.isFinite(ahead) ? ahead : null,
        behind: Number.isFinite(behind) ? behind : null,
      };
    } catch {
      // No upstream configured (or another failure) — repo/branch are known,
      // but no ahead/behind comparison is possible.
      return { branch: status.branch, isDirty: status.isDirty, ahead: null, behind: null };
    }
  }
}

function errMessage(err: unknown): string {
  // execFile rejections carry the combined stderr; prefer it over the generic
  // "Command failed" wrapper for a useful warning toast.
  const stderr = (err as { stderr?: string })?.stderr?.trim();
  if (stderr) return stderr;
  return err instanceof Error ? err.message : String(err);
}
