/**
 * M28 Git Sync — best-effort mirroring of claude4spec actions into the user's
 * git repository. This service OWNS every `git` subprocess call (the only git
 * shell-out in the server). All methods are best-effort: a missing/broken git,
 * a missing repo, or a failed command never throws to the caller — it resolves
 * to a non-throwing result shape.
 *
 * `detect()` answers "is any root of kind `pages` inside a worktree, and what does
 * it look like". `commit()` / `push()` perform the two sync actions. `commitOnRelease()`
 * / `pushOnPush()` are the gated entry points the hooks call: they read the
 * (hot-reloaded) config flag, detect the repo, and either act or return `null`
 * (flag off OR no repo). `commitPull()` is the 0.1.124 sibling of
 * `commitOnRelease()` for the "pull unreleased changes" flow — gated the same
 * way, but always returns a `GitCommitResult` (never `null`) since its caller
 * (`releaseService.updateRelease`) needs a result to decide whether to assign
 * the SQLite `release_id` cache.
 *
 * Spec: brief 0-1-37-to-0-1-38.md (M28); 0-1-123-to-0-1-124.md (commitPull,
 * error recovery).
 */

import { SYSTEM_ROOTS } from '../../shared/root-kinds.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configPath, readConfig, type NormalizedGitCommitTargetConfig } from '../config.js';
import type {
  GitAheadBehindStatus,
  GitBranchesResponse,
  GitCheckoutResponse,
  GitCommitResult,
  GitErrorRecovery,
  GitFetchResponse,
  GitSyncResponse,
  GitPushResult,
  GitRefDiff,
  GitRepoInfo,
} from '../../shared/git.js';
import { renderCommitTargetTemplate, localDateYYYYMMDD } from '../../shared/git.js';
import type { WsEmitter } from '../ws/project-emitter.js';

const pexec = promisify(execFile);

/**
 * 2.1.10 (M28 h8tvjbdd): limit for a network git operation (`fetch`, `push`,
 * `sync`) — missing credentials, a rejected auth or a hung remote end as
 * `status: 'error'` instead of a request that never returns.
 */
export const GIT_NETWORK_TIMEOUT_MS = 60_000;

/**
 * 2.1.10 (M28 ezudoqef): ONE lock per repository over every operation of this
 * module that writes to `.git` — release commit, "pull" commit, push, checkout,
 * fetch and sync. Release-driven operations WAIT (`run`); sidebar
 * operations (`checkout`, `fetch`, `sync`) REFUSE with `busy` when it is taken
 * (`tryRun`). Status reads never take it. The hand-off in `release()` keeps
 * the lock held while a waiter exists, so a `tryRun` can never slip in between
 * one holder and the next queued one.
 */
export class GitRepoLock {
  private locked = false;
  private readonly waiters: Array<() => void> = [];

  get isHeld(): boolean {
    return this.locked;
  }

  private release(): void {
    // Hand-off: a waiter inherits the lock without it ever reading as free.
    const next = this.waiters.shift();
    if (next) next();
    else this.locked = false;
  }

  /** Run `fn` with the lock already held by the caller; release when it settles. */
  private async runHeld<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Wait for the lock, run `fn`, release. A free lock is taken and `fn` started
   * in the same tick (like `tryRun`) — no microtask gap before the holder runs.
   */
  run<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.locked) {
      this.locked = true;
      return this.runHeld(fn);
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve)).then(() => this.runHeld(fn));
  }

  /** Run `fn` under the lock if it is free right now; `null` (no call) when it is taken. */
  tryRun<T>(fn: () => Promise<T>): Promise<T> | null {
    if (this.locked) return null;
    this.locked = true;
    return this.runHeld(fn);
  }
}

/** Locks keyed by repository (worktree root) — several projects in one repo share one. */
const repoLocks = new Map<string, GitRepoLock>();

function lockForKey(key: string): GitRepoLock {
  let lock = repoLocks.get(key);
  if (!lock) {
    lock = new GitRepoLock();
    repoLocks.set(key, lock);
  }
  return lock;
}

const BUSY_MESSAGE = 'A background task is running — try again in a moment.';

/**
 * 0.1.125: is `name` a valid git ref (branch) name (`git check-ref-format
 * --branch <name>`)? Doesn't need a repo — git validates the syntax alone.
 * Used by the PATCH /api/config route (preview-render check on a `new`-mode
 * template) and available for any other ref-safety check. Never throws.
 */
export async function isValidGitRefName(name: string): Promise<boolean> {
  try {
    await pexec('git', ['check-ref-format', '--branch', name]);
    return true;
  } catch {
    return false;
  }
}

const NOT_DETECTED: GitRepoInfo = {
  detected: false,
  rootPath: null,
  remoteUrl: null,
  branch: null,
  isDirty: false,
};

export class GitService {
  /** Dirs of the roots of kind `pages` resolved to absolute paths — `detect()`'s probe locations, and the user part of the staging set. */
  private readonly pageRootDirs: string[];

  /**
   * @param cwd                project root (holds `.claude4spec/config.json`).
   * @param pageRootDirs       2.1.8: dirs of the roots of KIND `pages` (absolute
   *                           or cwd-relative) — the probe locations for repo
   *                           detection (a page root may live in a sub-worktree)
   *                           and, with the system roots, the staging set.
   * @param hasInFlightTurn    0.1.123: reports whether an agent turn is
   *                           currently mutating disk — `checkout()` hard-blocks
   *                           on this (a branch switch would race live writes).
   *                           Defaults to "never busy" so every existing
   *                           `new GitService(cwd, dirs)` call site keeps working.
   * @param ws                 2.1.10 (M49 7xmafzkd): the project's room emitter —
   *                           `git:status-changed` goes out through it after every
   *                           operation that changed refs or HEAD. `null` = no
   *                           emission (tests, tools without a room).
   * @param markHeadChangeOrigin 2.1.10 (M40 j37qjvvh): labels — as caused by the
   *                           server — every ABSOLUTE path a HEAD change made
   *                           from the app (checkout, sync) is about to rewrite,
   *                           on the CURRENT context instance, before HEAD moves.
   *                           `null` = no labelling (tests, tools without mounts).
   */
  constructor(
    private cwd: string,
    pageRootDirs: string[],
    private hasInFlightTurn: () => boolean = () => false,
    private ws: WsEmitter | null = null,
    private markHeadChangeOrigin: ((absPaths: string[]) => void) | null = null,
  ) {
    this.pageRootDirs = pageRootDirs.map((d) => path.resolve(cwd, d));
  }

  /**
   * Run `git <args>` in `dir`. Throws on non-zero exit or a missing binary.
   * 0.1.125: optional `env` override — used by the temp-index commit-target
   * flow (`GIT_INDEX_FILE`) so `read-tree`/`add`/`write-tree` operate on a
   * scratch index instead of the repo's real one.
   */
  private async git(
    args: string[],
    dir: string,
    env?: NodeJS.ProcessEnv,
    timeoutMs?: number,
  ): Promise<{ stdout: string; stderr: string }> {
    return pexec('git', args, { cwd: dir, ...(env ? { env } : {}), ...(timeoutMs ? { timeout: timeoutMs } : {}) });
  }

  /**
   * 2.1.10 (M28 h8tvjbdd): run a NETWORK git command (`fetch`, `push`)
   * non-interactively with a time limit — no terminal prompt
   * (`GIT_TERMINAL_PROMPT=0`), no askpass helper (`GIT_ASKPASS`/`SSH_ASKPASS`
   * empty), no interactive credential manager (`GCM_INTERACTIVE=never`), SSH in
   * batch mode (`-o BatchMode=yes` appended to the user's own ssh command).
   * Non-interactive credential helpers (keychain, store) keep working. A
   * timeout rejects with a git-style message in `stderr`.
   */
  private async gitNetwork(args: string[], dir: string): Promise<{ stdout: string; stderr: string }> {
    const configuredSsh = await this.git(['config', '--get', 'core.sshCommand'], dir)
      .then((r) => r.stdout.trim())
      .catch(() => '');
    const sshBase = process.env.GIT_SSH_COMMAND || configuredSsh || 'ssh';
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
      SSH_ASKPASS_REQUIRE: 'never',
      GCM_INTERACTIVE: 'never',
      GIT_SSH_COMMAND: `${sshBase} -o BatchMode=yes`,
    };
    try {
      return await this.git(args, dir, env, GIT_NETWORK_TIMEOUT_MS);
    } catch (err) {
      const e = err as { killed?: boolean; signal?: string | null; stderr?: string };
      if (e && (e.killed || e.signal === 'SIGTERM')) {
        const partial = (e.stderr ?? '').trim();
        const timeoutMsg = `git ${args[0]} timed out after ${GIT_NETWORK_TIMEOUT_MS / 1000} s`;
        throw Object.assign(new Error(timeoutMsg), { stderr: partial ? `${partial}\n${timeoutMsg}` : timeoutMsg });
      }
      throw err;
    }
  }

  /** 2.1.10: the lock of the repository this service's page roots live in (keyed by worktree root). */
  private async repoLock(): Promise<GitRepoLock> {
    const root = await this.probeRoot();
    return lockForKey(root ?? `cwd:${path.resolve(this.cwd)}`);
  }

  /** 2.1.10 (M49 7xmafzkd): `git:status-changed` to the project's room. */
  private emitStatusChanged(headChanged: boolean): void {
    try {
      this.ws?.broadcast({ kind: 'git:status-changed', headChanged });
    } catch (err) {
      console.warn('[git] git:status-changed broadcast failed:', errMessage(err));
    }
  }

  /**
   * Probe the roots of kind `pages` for a git worktree root path. Detected when ANY
   * page root is inside a worktree; the first such root wins. Never
   * throws — git missing (ENOENT), no repo, or a root outside any worktree
   * (exit 128) all resolve to `null`. Shared by `detect()` and every
   * lighter-weight caller (`listBranches()`, `checkout()`) that only needs the
   * root, not the full `remote get-url`/`status --porcelain` probe.
   */
  private async probeRoot(): Promise<string | null> {
    for (const dir of this.pageRootDirs) {
      let real: string;
      try {
        real = fs.realpathSync(dir);
      } catch {
        continue; // missing path — cannot probe from it
      }
      try {
        const { stdout } = await this.git(['rev-parse', '--show-toplevel'], real);
        const top = stdout.trim();
        if (top) return top;
      } catch {
        // not inside a worktree (or git missing) — try the next root
      }
    }
    return null;
  }

  /** Current branch at an already-probed `rootPath`; `null` on detached HEAD. */
  private async currentBranch(rootPath: string): Promise<string | null> {
    return this.git(['rev-parse', '--abbrev-ref', 'HEAD'], rootPath)
      .then((r) => {
        const b = r.stdout.trim();
        // Detached HEAD reports the literal "HEAD" — surface as no branch.
        return b && b !== 'HEAD' ? b : null;
      })
      .catch(() => null);
  }

  /**
   * 0.1.125: read-only, never-throw resolution of the "default" base branch
   * for `commitTarget.mode === 'new'` when `base` is `null` (auto-detect).
   * Order: `origin/HEAD` symref (stripped of the `origin/` prefix) → local
   * `main` → local `master` → current branch (`null` on detached HEAD or a
   * repo with no commits at all — the caller maps that to `base-missing`).
   */
  private async resolveDefaultBranch(root: string): Promise<string | null> {
    const originHead = await this.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root)
      .then((r) => r.stdout.trim().replace(/^origin\//, ''))
      .catch(() => '');
    if (originHead) return originHead;
    for (const candidate of ['main', 'master']) {
      const exists = await this.git(['rev-parse', '--verify', `refs/heads/${candidate}`], root)
        .then(() => true)
        .catch(() => false);
      if (exists) return candidate;
    }
    return this.currentBranch(root);
  }

  /**
   * Probe the roots of kind `pages` for a git worktree. Never throws — git
   * missing, no repo, or a root outside any worktree all map to
   * `detected: false`.
   */
  async detect(): Promise<GitRepoInfo> {
    const rootPath = await this.probeRoot();
    if (!rootPath) return NOT_DETECTED;

    // Inside a worktree — the remaining probes are individually best-effort.
    const remoteUrl = await this.git(['remote', 'get-url', 'origin'], rootPath)
      .then((r) => r.stdout.trim() || null)
      .catch(() => null);

    const branch = await this.currentBranch(rootPath);

    // 2.1.10 (M28 ezudoqef): a status read takes no lock and no OPTIONAL git
    // lock either (`status` would otherwise refresh the index under index.lock)
    // — a refetch on window focus must never collide with a running write.
    const isDirty = await this.git(['--no-optional-locks', 'status', '--porcelain'], rootPath)
      .then((r) => r.stdout.trim().length > 0)
      .catch(() => false);

    return { detected: true, rootPath, remoteUrl, branch, isDirty };
  }

  /**
   * Canonicalize the staging targets shared by `commit()` and `commitPull()`:
   * the dir of every registry root + `config.json`, realpath'd and filtered to those actually
   * inside `root`. Root dirs / configPath may be reached through a symlink
   * (e.g. `.claude/skills/specyfikacja` → another repo's worktree). `git add`
   * matches pathspecs lexically against the real worktree root, so an
   * unresolved symlink path reads as "outside repository" — resolve to real
   * paths first.
   *
   * 2.1.8 (M28 aqys9dje): the staging set IS the root registry — the dir of every
   * root, whatever its kind: the `pages` roots, `entities` (entity files +
   * `tags.json`), `releases` (so a new release's identity file lands in the same
   * commit as its marker, for `resolveReleaseCommit` later), `plans`, `briefs`
   * and `patches`. Roots of a kind without the `release` flag ride along in the
   * commit, outside the `release_diff` dimension. While the git master switch is
   * off the `gitignore`-flagged roots are still ignored, so staging them is a
   * harmless no-op (`git add` on an ignored path adds nothing).
   */
  private resolveStagingTargets(root: string): string[] {
    // 2.1.8: the staging set is derived from the ROOT REGISTRY — the dir of
    // EVERY root (all `pages` roots, `entities` with `tags.json`, `releases`,
    // `plans`/`briefs`/`patches`) plus `config.json`. No user root is skipped,
    // whatever a legacy `releasable: false` once said. The page roots are the
    // EFFECTIVE ones this service was built with (`--pages` override applied);
    // the system roots come from code.
    const targets: string[] = [];
    for (const p of new Set([
      ...this.pageRootDirs,
      ...SYSTEM_ROOTS.map((r) => path.resolve(this.cwd, r.dir)),
      configPath(this.cwd),
    ])) {
      let real: string;
      try {
        real = fs.realpathSync(p);
      } catch {
        continue; // missing path — nothing to stage from it
      }
      const rel = path.relative(root, real);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) targets.push(real);
      else console.warn(`[git] ${p} lies outside the repository at ${root} — not staged`);
    }
    return targets;
  }

  /**
   * Stage `resolveStagingTargets()` and commit with `message`. Assumes a repo
   * is detected (callers gate via `commitOnRelease`/`commitPull`). Returns
   * `'skipped'` on detached HEAD, `'nothing-to-commit'` when nothing is
   * staged, `'error'` (with `recovery`) on any git failure.
   */
  private async stageAndCommit(
    status: GitRepoInfo,
    message: string,
    operation: GitErrorRecovery['operation'],
  ): Promise<GitCommitResult> {
    if (!status.detected || !status.rootPath) return { status: 'skipped' };
    if (!status.branch) return { status: 'skipped', message: 'detached HEAD' };
    const root = status.rootPath;

    const targets = this.resolveStagingTargets(root);
    if (targets.length === 0) {
      return {
        status: 'skipped',
        message: 'page roots / config.json are outside the detected repository',
      };
    }

    try {
      await this.git(['add', '--', ...targets], root);
    } catch (err) {
      return { status: 'error', message: errMessage(err), recovery: this.buildRecovery(operation, err, root) };
    }

    // `git diff --cached --quiet` exits 0 when nothing is staged, 1 otherwise.
    try {
      await this.git(['diff', '--cached', '--quiet'], root);
      return { status: 'nothing-to-commit' };
    } catch {
      // non-zero ⇒ there are staged changes; fall through to commit.
    }

    try {
      await this.git(['commit', '-m', message], root);
      return { status: 'committed' };
    } catch (err) {
      return { status: 'error', message: errMessage(err), recovery: this.buildRecovery(operation, err, root) };
    }
  }

  /**
   * Stage every registry root dir + `config.json` and commit with a
   * `name`/`description`-derived message. Assumes a repo is detected
   * (callers gate via `commitOnRelease`). Returns `'skipped'` on detached
   * HEAD, `'nothing-to-commit'` when nothing is staged, `'error'` on any git
   * failure.
   *
   * 0.1.125: dispatches on `config.git.commitTarget.mode`:
   *   - `'current'` (default, absent): unchanged — stage + commit on the
   *     real index/HEAD via `stageAndCommit`.
   *   - `'named'`: commit onto an EXISTING branch's tip via a temp index —
   *     never touches HEAD, the working tree, or the real index.
   *   - `'new'`: commit onto a NEW branch grown from a base branch's tip
   *     (never from HEAD) — same temp-index mechanism.
   * For `'named'`/`'new'`, when `switchAfterRelease` is on, attempts a
   * post-commit switch (bypassing the dirty/busy pre-guards `checkout()`
   * enforces — see `switchAfterCommit`). The commit itself is already
   * durable by the time a switch is attempted, so a switch failure is
   * reported as `status: 'error'` (with `recovery.kind`) while still
   * carrying `branch` — the caller can tell the commit landed even though
   * the switch didn't.
   */
  async commit(opts: { name: string; description: string }): Promise<GitCommitResult> {
    // 2.1.10 (M28 ezudoqef): a release commit WAITS for the repository lock —
    // a release never loses to a sidebar click.
    const lock = await this.repoLock();
    const { result, headBranch } = await lock.run(async () => {
      const status = await this.detect();
      return { result: await this.commitUnlocked(opts, status), headBranch: status.branch };
    });
    if (result.status === 'committed') {
      // HEAD of the current branch moved: a 'current'-mode commit (no `branch`),
      // a named target that IS the current branch, or a post-commit switch.
      const headChanged = result.switched === true || !result.branch || result.branch === headBranch;
      this.emitStatusChanged(headChanged);
    }
    return result;
  }

  private async commitUnlocked(
    opts: { name: string; description: string },
    status: GitRepoInfo,
  ): Promise<GitCommitResult> {
    // ASSUMPTION:dev-0013 — no `Release ` prefix (pre-window message format kept).
    const message = opts.description ? `${opts.name}\n\n${opts.description}` : opts.name;
    const config = readConfig(this.cwd);
    const commitTarget: NormalizedGitCommitTargetConfig = config.git.commitTarget;
    const mode = commitTarget.mode;

    let result: GitCommitResult;
    if (mode === 'named' && status.detected && status.rootPath && commitTarget.branch) {
      if (commitTarget.branch === status.branch) {
        // The "named" target IS the currently checked-out branch — commit
        // via the real index/HEAD path instead of the scratch-index one.
        // Advancing the current branch's ref through a scratch index while
        // never touching the real index/working tree would leave `git
        // status` permanently confused (the just-committed file would show
        // as both staged-deleted and untracked, even though its on-disk
        // content matches the commit exactly) — this produces the identical
        // outcome (a commit lands on `status.branch`) via the safe path.
        result = await this.stageAndCommit(status, message, 'commit-on-release');
        if (result.status === 'committed') result = { ...result, branch: status.branch };
      } else {
        result = await this.commitToNamedBranch(status, message, commitTarget.branch);
      }
    } else if (mode === 'new' && status.detected && status.rootPath && commitTarget.template) {
      result = await this.commitToNewBranch(status, message, {
        template: commitTarget.template,
        base: commitTarget.base,
        releaseName: opts.name,
        date: localDateYYYYMMDD(new Date()),
      });
    } else {
      // 'current' mode, OR a 'named'/'new' config missing its required
      // sub-field (e.g. a hand-edited config.json) — defensively fall back
      // to the always-safe legacy behavior rather than failing the release.
      result = await this.stageAndCommit(status, message, 'commit-on-release');
    }

    if (
      result.status === 'committed' &&
      mode !== 'current' &&
      config.git.switchAfterRelease &&
      result.branch &&
      status.rootPath
    ) {
      const { switched, recovery } = await this.switchAfterCommit(status.rootPath, result.branch);
      if (!switched) {
        return { status: 'error', branch: result.branch, recovery };
      }
      return { ...result, switched: true };
    }
    return result;
  }

  /**
   * 0.1.125: commit-target `'named'` — commit the staged spec deltas onto
   * an EXISTING branch's tip via a temporary index, without touching HEAD,
   * the working tree, or the real index. `branch-missing` when it doesn't
   * resolve as a local branch.
   */
  private async commitToNamedBranch(
    status: GitRepoInfo,
    message: string,
    branch: string,
  ): Promise<GitCommitResult> {
    const root = status.rootPath!;
    const tipSha = await this.git(['rev-parse', '--verify', `refs/heads/${branch}`], root)
      .then((r) => r.stdout.trim())
      .catch(() => null);
    if (!tipSha) {
      const err = new Error(`Branch "${branch}" was not found.`);
      return {
        status: 'error',
        message: err.message,
        recovery: this.buildRecovery('commit-on-release', err, root, 'branch-missing'),
      };
    }
    return this.commitOntoTipViaTempIndex(root, message, tipSha, branch);
  }

  /**
   * 0.1.125: commit-target `'new'` — commit onto a brand-new branch grown
   * from a base branch's tip (never HEAD), via the same temp-index
   * mechanism. `base-missing` when the base can't be resolved (explicit
   * `base` gone, or auto-detection finds nothing — e.g. a repo with no
   * commits). A rendered name colliding with an existing branch gets a `-2`,
   * `-3`, … suffix until one is free.
   */
  private async commitToNewBranch(
    status: GitRepoInfo,
    message: string,
    target: { template: string; base: string | null; releaseName: string; date: string },
  ): Promise<GitCommitResult> {
    const root = status.rootPath!;
    const baseBranch = target.base ?? (await this.resolveDefaultBranch(root));
    if (!baseBranch) {
      const err = new Error('Could not resolve a base branch (repository has no commits).');
      return {
        status: 'error',
        message: err.message,
        recovery: this.buildRecovery('commit-on-release', err, root, 'base-missing'),
      };
    }
    const baseTipSha = await this.git(['rev-parse', '--verify', `refs/heads/${baseBranch}`], root)
      .then((r) => r.stdout.trim())
      .catch(() => null);
    if (!baseTipSha) {
      const err = new Error(`Base branch "${baseBranch}" was not found.`);
      return {
        status: 'error',
        message: err.message,
        recovery: this.buildRecovery('commit-on-release', err, root, 'base-missing'),
      };
    }

    const renderedName = renderCommitTargetTemplate(target.template, {
      releaseName: target.releaseName,
      date: target.date,
    });
    let finalName = renderedName;
    let suffix = 2;
    while (
      await this.git(['rev-parse', '--verify', `refs/heads/${finalName}`], root)
        .then(() => true)
        .catch(() => false)
    ) {
      finalName = `${renderedName}-${suffix}`;
      suffix += 1;
    }

    return this.commitOntoTipViaTempIndex(root, message, baseTipSha, finalName);
  }

  /**
   * 0.1.125: shared plumbing for `commitToNamedBranch`/`commitToNewBranch`.
   *
   * Two phases, each in its own SCRATCH index (`GIT_INDEX_FILE`, never the
   * repo's real one) — never touches HEAD or the working tree:
   *
   * 1. Compute a "capture tree" for `resolveStagingTargets()` seeded from
   *    CURRENT HEAD (not `parentSha`) + a working-tree `git add` overlay —
   *    IDENTICAL to what a normal `'current'`-mode commit would produce for
   *    these same paths. Seeding from HEAD (rather than the foreign
   *    `parentSha`) matters: `git add <pathspec>` also stages a DELETION for
   *    anything tracked-in-index-but-missing-on-disk, so seeding from
   *    `parentSha` would silently delete any content the target/base branch
   *    has under these paths that the CURRENT branch's history never had —
   *    unrelated content divergence (e.g. a page that exists on a long-lived
   *    named branch's own accumulated history but was never on the current
   *    branch) would be destroyed. Scoping the deletion-sensitive `add` to
   *    HEAD keeps deletions meaningful only relative to the CURRENT branch's
   *    own history, exactly as `stageAndCommit` already does for `'current'`
   *    mode.
   * 2. Graft the capture tree's blobs at each staging-target path onto a
   *    FRESH index seeded from `parentSha` (the named/base branch's tip),
   *    via `git update-index --add --cacheinfo` per blob (enumerated with
   *    `git ls-tree -r`) — NEVER a wholesale `git rm`/replace of the path
   *    first. This only ever ADDS/UPDATES paths the capture actually has;
   *    anything parentSha already has under a staging-target path that the
   *    capture DOESN'T have (unrelated content — e.g. a page that exists on
   *    a long-lived named branch's own accumulated history but was never on
   *    the current branch) is left completely untouched, never deleted.
   *    The one asymmetric trade-off: an outright removal (current branch no
   *    longer has a file ANYWHERE) does not propagate as a deletion onto
   *    the named/new target — accepted deliberately, since silently
   *    destroying unrelated target content is a far worse failure mode than
   *    occasionally leaving a stale file on a side branch.
   *
   * `'nothing-to-commit'` when the resulting tree equals `parentSha`'s tree.
   */
  private async commitOntoTipViaTempIndex(
    root: string,
    message: string,
    parentSha: string,
    targetBranch: string,
  ): Promise<GitCommitResult> {
    const targets = this.resolveStagingTargets(root);
    if (targets.length === 0) {
      return {
        status: 'skipped',
        message: 'page roots / config.json are outside the detected repository',
      };
    }
    const relTargets = targets.map((abs) => path.relative(root, abs).split(path.sep).join('/'));

    let captureTree: string;
    try {
      captureTree = await this.buildCaptureTree(root, targets);
    } catch (err) {
      return { status: 'error', message: errMessage(err), recovery: this.buildRecovery('commit-on-release', err, root) };
    }

    const tmpIndex = tmpIndexPath();
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
    try {
      await this.git(['read-tree', parentSha], root, env);
      for (const rel of relTargets) {
        // rel === '' (a registry root's dir configured as the repo root itself)
        // means the capture's ENTIRE tree is in scope — `ls-tree -r <tree>`
        // with no pathspec lists everything; `-- ''` would be a malformed
        // empty pathspec, so omit `--`/the pathspec entirely in that case.
        const lsArgs = rel === '' ? ['ls-tree', '-r', captureTree] : ['ls-tree', '-r', captureTree, '--', rel];
        const lsOut = await this.git(lsArgs, root).then((r) => r.stdout).catch(() => '');
        for (const line of lsOut.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          // `<mode> blob <sha>\t<path>` — non-recursive subdir entries never
          // appear since `-r` recurses fully into blobs only.
          const m = trimmed.match(/^(\d+) blob ([0-9a-f]+)\t(.+)$/);
          if (m) {
            await this.git(['update-index', '--add', '--cacheinfo', `${m[1]},${m[2]},${m[3]}`], root, env);
          }
        }
      }
      const treeSha = (await this.git(['write-tree'], root, env)).stdout.trim();
      return this.finishCommitOntoTip(root, message, parentSha, targetBranch, treeSha);
    } catch (err) {
      return { status: 'error', message: errMessage(err), recovery: this.buildRecovery('commit-on-release', err, root) };
    } finally {
      cleanupTmpIndex(tmpIndex);
    }
  }

  /**
   * Build the "capture tree" described in `commitOntoTipViaTempIndex`'s doc
   * comment: `read-tree HEAD` (or an empty tree on unborn HEAD — a repo with
   * no commits yet) + `git add -- <targets>`, in its own scratch index.
   */
  private async buildCaptureTree(root: string, targets: string[]): Promise<string> {
    const tmpIndex = tmpIndexPath();
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
    try {
      const headExists = await this.git(['rev-parse', '--verify', 'HEAD'], root)
        .then(() => true)
        .catch(() => false);
      if (headExists) {
        await this.git(['read-tree', 'HEAD'], root, env);
      }
      await this.git(['add', '--', ...targets], root, env);
      return (await this.git(['write-tree'], root, env)).stdout.trim();
    } finally {
      cleanupTmpIndex(tmpIndex);
    }
  }

  /** Compare `treeSha` to `parentSha`'s tree; commit-tree + update-ref if different, else 'nothing-to-commit'. */
  private async finishCommitOntoTip(
    root: string,
    message: string,
    parentSha: string,
    targetBranch: string,
    treeSha: string,
  ): Promise<GitCommitResult> {
    const parentTreeSha = (await this.git(['rev-parse', `${parentSha}^{tree}`], root)).stdout.trim();
    if (treeSha === parentTreeSha) {
      return { status: 'nothing-to-commit' };
    }
    const commitSha = (await this.git(['commit-tree', treeSha, '-p', parentSha, '-m', message], root)).stdout.trim();
    await this.git(['update-ref', `refs/heads/${targetBranch}`, commitSha], root);
    return { status: 'committed', branch: targetBranch };
  }

  /**
   * 0.1.125: post-commit branch switch for `switchAfterRelease`, run only
   * after a `'named'`/`'new'` commit already succeeded. Deliberately does
   * NOT reuse the public `checkout()`'s dirty/busy pre-guards, which the
   * brief specifically wants bypassed here (the commit is already durable; a
   * failed switch must not be reported as if nothing happened) — EXCEPT the
   * `hasInFlightTurn()` busy check, which is NOT a pre-guard about this
   * switch's own state (unlike dirty) but a guard against racing a
   * concurrent agent turn's disk writes — the exact class of corruption
   * `hasInFlightTurn` was added in 0.1.123 to prevent for `checkout()`, and
   * equally applicable here (this method calls `git checkout` too).
   * Classifies a checkout failure by git's own stderr: a real working-tree
   * conflict → `'switch-dirty'`, anything else → `'switch-failed'`.
   */
  private async switchAfterCommit(
    root: string,
    branch: string,
  ): Promise<{ switched: boolean; recovery?: GitErrorRecovery }> {
    if (this.hasInFlightTurn()) {
      const err = new Error('A background task is running — try again in a moment.');
      return { switched: false, recovery: this.buildRecovery('commit-on-release', err, root, 'switch-failed') };
    }
    // Stage the same in-scope targets into the REAL index first. The
    // temp-index commit above never touched the real index, so these files
    // are still untracked here — and git's checkout unconditionally refuses
    // to overwrite ANY untracked file it would need to create, even one
    // whose content is byte-identical to the target branch's. Staging them
    // (relative to current HEAD) makes checkout compare them as ordinary
    // identical adds instead of untracked collisions. A genuine
    // out-of-scope conflict (a file NOT in resolveStagingTargets) still
    // blocks the checkout as intended — see `commitOntoTipViaTempIndex`.
    const targets = this.resolveStagingTargets(root);
    try {
      if (targets.length > 0) {
        await this.git(['add', '--', ...targets], root);
      }
      // Force English/portable git messages — the `switch-dirty` vs
      // `switch-failed` classification below pattern-matches git's stderr
      // text, which would otherwise misclassify under a non-English git
      // diagnostic locale (e.g. LANG=pl_PL.UTF-8).
      await this.git(['checkout', branch], root, { ...process.env, LC_ALL: 'C', LANG: 'C' });
      return { switched: true };
    } catch (err) {
      // Roll back the staging above so a failed switch never leaves the
      // real index holding release files staged on the ORIGINAL branch
      // (invisible to the caller, and a trap for a later unrelated `git
      // commit` there). `git reset` only touches the index, never the
      // working tree.
      if (targets.length > 0) {
        await this.git(['reset', '--', ...targets], root).catch(() => {});
      }
      const stderr = rawStderr(err);
      const kind: GitErrorRecovery['kind'] = /would be overwritten by checkout|commit your changes or stash/i.test(
        stderr,
      )
        ? 'switch-dirty'
        : 'switch-failed';
      return { switched: false, recovery: this.buildRecovery('commit-on-release', err, root, kind) };
    }
  }

  /**
   * 0.1.124: best-effort commit of the working tree when pulling unreleased
   * changes into the latest release (`releaseService.updateRelease({
   * assignUnreleased: true })`). Same staging scope as `commit()` — no
   * exclusion of the `releases` root is needed: this method is never called
   * alongside a NEW release-identity-file write, so no new marker file ever
   * lands in this commit; staging the `releases` root here is harmless. Gate:
   * `config.git.enabled` + a detected repo with a branch (mirrors
   * `commitOnRelease`/`pushOnPush`) — on gate failure returns `{ status:
   * 'skipped' }` rather than `null` (unlike the other two hooks, this method
   * always returns a result, never throws).
   */
  async commitPull(latest: { name: string }): Promise<GitCommitResult> {
    const config = readConfig(this.cwd);
    if (!config.git.enabled) return { status: 'skipped' };
    const status = await this.detect();
    if (!status.detected || !status.branch) return { status: 'skipped' };
    // 2.1.10 (M28 ezudoqef): release-driven — waits for the repository lock.
    const lock = await this.repoLock();
    const result = await lock.run(async () => {
      const fresh = await this.detect();
      if (!fresh.detected || !fresh.branch) return { status: 'skipped' } as GitCommitResult;
      return this.stageAndCommit(fresh, `Pull to ${latest.name}`, 'pull');
    });
    if (result.status === 'committed') this.emitStatusChanged(true);
    return result;
  }

  /**
   * Push a branch to its remote. Assumes a repo is detected.
   * `'nothing-to-push'` when git reports "Everything up-to-date", `'skipped'`
   * on detached HEAD, `'error'` on a missing upstream or any other failure.
   *
   * 0.1.125: optional `branch` — when given and it differs from the current
   * branch, pushes it explicitly (`git push origin <branch>`, the remote
   * name this codebase already assumes elsewhere — see `detect()`'s `git
   * remote get-url origin`). Omitted (or equal to the current branch): the
   * original bare `git push` (current branch's configured upstream) —
   * unchanged default behavior. An EXPLICIT `branch` has nothing to do with
   * current HEAD, so the detached-HEAD skip only applies when there's no
   * explicit branch to push — otherwise a caller resolving a specific branch
   * (e.g. `ReleasePushService`, which finds the branch actually carrying a
   * release's marker commit) would be silently ignored whenever the
   * currently checked-out ref happened to be detached for any unrelated
   * reason.
   */
  async push(branch?: string): Promise<GitPushResult> {
    // 2.1.10 (M28 ezudoqef): the push of a release push WAITS for the lock.
    const lock = await this.repoLock();
    const result = await lock.run(() => this.pushUnlocked(branch));
    // A push moves only remote-tracking refs — never HEAD.
    if (result.status === 'pushed') this.emitStatusChanged(false);
    return result;
  }

  private async pushUnlocked(branch?: string): Promise<GitPushResult> {
    const status = await this.detect();
    if (!status.detected || !status.rootPath) return { status: 'skipped' };

    const explicit = !!branch && branch !== status.branch;
    if (!explicit && !status.branch) return { status: 'skipped', message: 'detached HEAD' };
    const targetBranch = branch ?? status.branch!;
    const args = explicit ? ['push', 'origin', branch!] : ['push'];

    try {
      // 2.1.10 (M28 h8tvjbdd): non-interactive, time-limited.
      const { stdout, stderr } = await this.gitNetwork(args, status.rootPath);
      if (/Everything up-to-date/i.test(`${stdout}\n${stderr}`)) {
        return { status: 'nothing-to-push', branch: targetBranch };
      }
      return { status: 'pushed', branch: targetBranch };
    } catch (err) {
      // 2.1.10 (M28 sw1u84nn): a non-fast-forward rejection is told apart from
      // other push failures — the recovery window offers `sync()` for it.
      const kind = isNonFastForwardRejection(err) ? 'non-fast-forward' : undefined;
      return {
        status: 'error',
        message: errMessage(err),
        recovery: this.buildRecovery('push', err, status.rootPath, kind),
      };
    }
  }

  /**
   * 0.1.125 read-only: local branch(es) containing `sha`
   * (`git branch --contains <sha>`). Used by the push step to find the
   * branch that actually carries a release's marker commit, so push targets
   * that branch rather than blind current HEAD. Prefers the current branch
   * when it's among the matches (stability); otherwise the first match.
   * `null` on no match, no repo, or any failure.
   */
  async branchContainingCommit(sha: string): Promise<string | null> {
    const status = await this.detect();
    if (!status.detected || !status.rootPath) return null;
    try {
      const { stdout } = await this.git(
        ['branch', '--contains', sha, '--format=%(refname:short)'],
        status.rootPath,
      );
      const branches = stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      if (branches.length === 0) return null;
      if (status.branch && branches.includes(status.branch)) return status.branch;
      return branches[0]!;
    } catch {
      return null;
    }
  }

  /**
   * Gated commit hook. `null` when the git master switch is off, no repo is
   * detected, or the detected repo has no branch (detached HEAD); otherwise
   * the `commit()` result. `enabled` is checked FIRST so a disabled project
   * never pays for the `detect()` subprocess round-trip. Reads config
   * per-call (hot-reload).
   *
   * 0.1.124: the gate no longer also checks a separate commit-sync toggle —
   * `git.enabled` alone now means "commit on release too" (the
   * `syncCommitOnRelease` sub-toggle was removed; there is no longer a "git
   * on, but doesn't commit" state).
   *
   * 0.1.125: the `!status.branch` (detached HEAD) part of the gate only
   * applies to `commitTarget.mode === 'current'` — that mode commits via the
   * real index/HEAD, which genuinely needs a branch to advance. `'named'`/
   * `'new'` commit onto a DIFFERENT ref via a scratch index and never read
   * `status.branch` at all, so requiring one here would silently no-op the
   * very modes built to not need current HEAD on a branch.
   */
  async commitOnRelease(release: { name: string; description: string }): Promise<GitCommitResult | null> {
    const config = readConfig(this.cwd);
    if (!config.git.enabled) return null;
    const status = await this.detect();
    if (!status.detected) return null;
    const mode = config.git.commitTarget.mode;
    if (mode === 'current' && !status.branch) return null;
    return this.commit(release);
  }

  /**
   * Gated push hook. `null` when the git master switch is off, push-sync is
   * off, no repo is detected, or the detected repo has no branch (detached
   * HEAD); otherwise the `push()` result. Reads config per-call (hot-reload).
   *
   * 0.1.125: optional `branch` — forwarded to `push()` so the caller (e.g.
   * `ReleasePushService`, which resolves the branch actually carrying the
   * release's marker commit) can direct the push there instead of blind
   * current HEAD.
   */
  async pushOnPush(branch?: string): Promise<GitPushResult | null> {
    const config = readConfig(this.cwd);
    if (!config.git.enabled || !config.git.syncPushOnPush) return null;
    const status = await this.detect();
    if (!status.detected || !status.branch) return null;
    return this.push(branch);
  }

  /**
   * 0.1.124: compose the `GitErrorRecovery` payload for a failed git
   * operation — `reason` (short human summary, via `errMessage`) + raw
   * `gitStderr` + a backend-composed `intentPrompt` for `startSeededThread`.
   * The prompt instructs the agent to use only safe, non-destructive git
   * operations (`status`/`stash`/`commit`) via its built-in Bash tool — never
   * `--force`/`reset --hard`/anything that could discard work.
   *
   * 0.1.125: optional `kind` — narrows WHY, for the new branch-related
   * failure modes (`branch-missing`/`base-missing`/`switch-failed`/
   * `switch-dirty`). Omitted for ordinary git failures (pre-existing 3 call
   * sites keep working unchanged).
   */
  private buildRecovery(
    operation: GitErrorRecovery['operation'],
    err: unknown,
    rootPath: string,
    kind?: GitErrorRecovery['kind'],
  ): GitErrorRecovery {
    const gitStderr = rawStderr(err);
    if (kind === 'non-fast-forward') {
      // 2.1.10 (M28 u5vl07ch): the window offers Sync, not the agent; the
      // prompt stays populated (the payload's contract) and says the same.
      const intentPrompt = [
        `claude4spec's git sync could not push to the remote, in the repository at ${rootPath}: ` +
          'the remote has commits that the local branch does not have yet (non-fast-forward).',
        '',
        `Git error:\n${gitStderr || errMessage(err)}`,
        '',
        'Please bring the remote commits in safely (`git fetch`, then a fast-forward or a merge — never ' +
          '`--force`, `reset --hard`, or a rebase of published commits), then push again. Report back ' +
          'what you found and what you did.',
      ].join('\n');
      return {
        operation,
        reason: 'the remote rejected the push (non-fast-forward)',
        gitStderr,
        intentPrompt,
        kind,
      };
    }
    const reason = errMessage(err);
    const opLabel =
      operation === 'commit-on-release'
        ? 'committing the spec on release'
        : operation === 'pull'
          ? 'committing pulled changes into the latest release'
          : 'pushing the current branch to its remote';
    const intentPrompt = [
      `claude4spec's git sync failed while ${opLabel}, in the repository at ${rootPath}.`,
      '',
      `Git error:\n${gitStderr || reason}`,
      '',
      'Please investigate and fix this safely. Only use non-destructive git operations ' +
        '(e.g. `git status`, `git stash`, `git commit`) via your Bash tool — never `--force`, ' +
        '`reset --hard`, or anything else that could discard uncommitted work. Report back what ' +
        'you found and what you did.',
    ].join('\n');
    return { operation, reason, gitStderr, intentPrompt, ...(kind ? { kind } : {}) };
  }

  /**
   * 0.1.118 read-only: SHA of the commit that first ADDED `absPath` — this is
   * a release's "marker" commit (0.1.124 terminology; previously "anchor").
   * `null` when git is disabled, no repo is detected, `absPath` is outside
   * the repo, or the file has never been added (e.g. `git.enabled` was off
   * when it was created — B3, a known open edge). Never throws.
   *
   * 0.1.124: the marker itself is no longer used directly as a diff boundary
   * — `ReleaseService.resolveReignRef` derives the actual "reign" snapshot
   * boundary from it (the commit before the NEXT release's marker, or `HEAD`
   * for the latest release).
   *
   * Deliberately NOT `git log --diff-filter=A -1 --format=%H` — `git log`
   * without `--reverse` walks history newest-first, so a bare `-1` returns
   * the MOST RECENT add, not the first. That matters because a release's
   * identity file can be deleted then re-created at the exact same path
   * (rename away, then later rename back to a name that slugifies the same)
   * — fetch every add and take the oldest so this always resolves to the
   * ORIGINAL creation commit, matching the documented contract.
   *
   * 0.1.125: a commit-target `'named'`/`'new'` commit may land on a branch
   * other than the current one, so the marker must be findable regardless
   * of which branch it's actually reachable from now — but searching `--all`
   * (every ref) unconditionally would risk resolving a same-slug marker on a
   * totally unrelated branch (e.g. two independent long-lived commit-target
   * branches that each happen to carry an identically-slugged release file).
   * So: try the narrow, HEAD-scoped search FIRST (identical to pre-0.1.125
   * behavior, unambiguous for the default `'current'` mode and any marker
   * that's still reachable from HEAD) — only widen to `--all` when that
   * comes up empty, which is exactly the new 0.1.125 need (a `'named'`/`'new'`
   * marker that was never reachable from current HEAD to begin with).
   */
  async resolveReleaseCommit(absPath: string): Promise<string | null> {
    const config = readConfig(this.cwd);
    if (!config.git.enabled) return null;
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
    const onHead = await this.findFirstAdd(status.rootPath, real, false);
    if (onHead) return onHead;
    return this.findFirstAdd(status.rootPath, real, true);
  }

  /**
   * `git log [--all] --diff-filter=A -- <absPath>`, oldest add wins (see
   * `resolveReleaseCommit`'s doc comment for why NOT `-1` without `--reverse`).
   * `null` on any failure (missing repo, git error, no add found).
   */
  private async findFirstAdd(rootPath: string, absPath: string, all: boolean): Promise<string | null> {
    try {
      const { stdout } = await this.git(
        ['log', ...(all ? ['--all'] : []), '--diff-filter=A', '--format=%H', '--', absPath],
        rootPath,
      );
      const shas = stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      // Output is newest-first; the LAST line is the oldest — the first add.
      return shas.length > 0 ? shas[shas.length - 1]! : null;
    } catch {
      return null;
    }
  }

  /**
   * Canonicalize `pathspecs` to realpaths inside `root` — shared by `diffRefs`/
   * `diffRefToWorkingTree`.
   *
   * 0.2.102: a pathspec that does not exist on disk is NOT dropped any more — a
   * single-page pathspec (from `release_diff`'s `paths` filter) legitimately
   * names a file deleted in the working tree or on one side of the diff. The
   * nearest existing ancestor is realpath'd and the missing tail re-appended; git
   * accepts a pathspec for a path absent from the working tree.
   */
  private resolveDiffTargets(root: string, pathspecs: string[]): string[] {
    const targets: string[] = [];
    for (const p of pathspecs) {
      const real = realpathOfNearestAncestor(p);
      if (real === null) continue;
      const rel = path.relative(root, real);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) targets.push(real);
    }
    return targets;
  }

  /**
   * Parse `git diff --name-status` output into `{path, status}` pairs,
   * resolved to absolute paths under `root`. Shared by `diffRefs`/
   * `diffRefToWorkingTree`. Renames/copies are flattened into a
   * delete(old)+create(new) pair to keep the existing create/update/delete
   * vocabulary intact downstream.
   */
  private parseNameStatus(stdout: string, root: string): GitRefDiff['files'] {
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
      } else if (parts[1]) {
        // Any other single-letter status git may emit (T type-change, U
        // unmerged, X unknown, …) — surface as a modification rather than
        // silently dropping the file from the diff entirely.
        files.push({ path: path.join(root, parts[1]), status: 'M' });
      }
    }
    return files;
  }

  /**
   * 0.1.118 read-only: file-level diff between two commits (or, more
   * generally, two git revision expressions — a bare SHA, `HEAD`, or a
   * relative form like `<sha>~1`, all valid here), scoped to `pathspecs` —
   * what goes to `git diff` after `--`, where a directory and a file are one
   * category (release-flag root dirs + the `releases` root, or single page
   * files, per the caller). Uses
   * `--name-status` (not the brief's literal `git diff <a>..<b>`, which
   * alone does not produce a parseable `{path, status}` shape). Never throws
   * — `null` when git is disabled or no repo is detected; an empty
   * `{files: []}` when none of `pathspecs` resolve inside the repo.
   */
  async diffRefs(shaA: string, shaB: string, pathspecs: string[]): Promise<GitRefDiff | null> {
    const config = readConfig(this.cwd);
    if (!config.git.enabled) return null;
    const status = await this.detect();
    if (!status.detected || !status.rootPath) return null;
    const root = status.rootPath;

    const targets = this.resolveDiffTargets(root, pathspecs);
    if (targets.length === 0) return { files: [] };

    try {
      // `-c core.quotePath=false`: without it, git quotes+octal-escapes any
      // path containing non-ASCII bytes (e.g. `"pages/Wydajno\305\233\304\207.md"`
      // for an accented filename) — a real risk here, this codebase's own
      // comments are in Polish. The naive tab-split below needs raw UTF-8
      // paths to produce a usable `{path, status}` pair.
      const { stdout } = await this.git(
        ['-c', 'core.quotePath=false', 'diff', '--name-status', `${shaA}..${shaB}`, '--', ...targets],
        root,
      );
      return { files: this.parseNameStatus(stdout, root) };
    } catch (err) {
      console.error('[git] diffRefs failed:', errMessage(err));
      return null;
    }
  }

  /**
   * 0.1.124 read-only: file-level diff between a commit/revision and the
   * CURRENT working tree (`git diff --name-status <sha> -- <pathspecs>`, no
   * second ref — includes both staged and unstaged changes to TRACKED
   * paths), PLUS untracked new files under `pathspecs` surfaced as `'A'`. Used
   * by the reign-model `getUnreleasedDiff` git-anchored fast path
   * (`:to='current'`).
   *
   * `git diff <ref>` alone never reports untracked files — that's a git
   * quirk (diff only compares tracked/staged content), not a bug — so a page
   * created in the editor but never `git add`ed would otherwise silently
   * vanish from a "current" diff. Rather than mutate the index (`git add -N`)
   * to make plain `diff` see it — invasive for a read-only method — run a
   * separate `git ls-files --others --exclude-standard` and merge its
   * results in as `'A'` entries; no overlap with the tracked diff is
   * possible by construction (an untracked path can never also appear in
   * `git diff`'s tracked-only output). Same scoping/parsing/never-throws
   * contract as `diffRefs` otherwise.
   */
  async diffRefToWorkingTree(sha: string, pathspecs: string[]): Promise<GitRefDiff | null> {
    const config = readConfig(this.cwd);
    if (!config.git.enabled) return null;
    const status = await this.detect();
    if (!status.detected || !status.rootPath) return null;
    const root = status.rootPath;

    const targets = this.resolveDiffTargets(root, pathspecs);
    if (targets.length === 0) return { files: [] };

    try {
      const [trackedResult, untrackedResult] = await Promise.all([
        this.git(['-c', 'core.quotePath=false', 'diff', '--name-status', sha, '--', ...targets], root),
        this.git(
          ['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '--', ...targets],
          root,
        ),
      ]);
      const files = this.parseNameStatus(trackedResult.stdout, root);
      for (const line of untrackedResult.stdout.split('\n')) {
        const relPath = line.trim();
        if (relPath) files.push({ path: path.join(root, relPath), status: 'A' });
      }
      return { files };
    } catch (err) {
      console.error('[git] diffRefToWorkingTree failed:', errMessage(err));
      return null;
    }
  }

  /**
   * 0.1.124 read-only: is `sha` an ancestor of (or equal to) the current
   * branch's HEAD (`git merge-base --is-ancestor <sha> HEAD`)? Used by the
   * "reign" snapshot resolution (`ReleaseService.resolveReignRef`) to guard
   * against a release marker that's no longer reachable from HEAD (e.g. an
   * implicit-pull commit later rebased away) — the reign-model diff must
   * fall back to the SQL/version-table path rather than trust a stale
   * marker. Gated on `config.git.enabled`; never throws — any failure (git
   * disabled, no repo, `sha` doesn't exist, `sha` genuinely isn't an
   * ancestor) all resolve to `false`, the conservative "don't trust it"
   * answer.
   */
  async isAncestorOfHead(sha: string): Promise<boolean> {
    const config = readConfig(this.cwd);
    if (!config.git.enabled) return false;
    const status = await this.detect();
    if (!status.detected || !status.rootPath) return false;
    try {
      await this.git(['merge-base', '--is-ancestor', sha, 'HEAD'], status.rootPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 0.1.124 read-only: a file's content at a specific commit (`git show
   * <sha>:<path>`). `status.rootPath` (from `detect()`, via `git rev-parse
   * --show-toplevel`) is always symlink-resolved, so `absPath` is realpath'd
   * first — same reasoning as `diffRefs`'s own per-target realpath loop —
   * tolerating a missing file (it may not exist in the CURRENT working tree
   * at all, e.g. deleted since; the as-given path is still usable for the
   * relative-to-root split in that case). Returns `null` when the file
   * doesn't exist at that commit (e.g. the created/deleted boundary of a
   * change), the path falls outside the repo, or git/repo detection fails —
   * never throws (class-wide contract, see file header — a malformed
   * config.json mid-run degrades to "can't tell", same as `statusAheadBehind`).
   *
   * `precomputedStatus` (0.1.124, same idea as `statusAheadBehind`'s): pass an
   * already-fetched `detect()` result so a caller reading many files at the
   * same two commits (e.g. `tryGitAnchoredDiff` diffing every changed page in
   * a release) doesn't pay for a repeated `detect()` probe — several git
   * subprocesses — per file.
   */
  async showFile(
    sha: string,
    absPath: string,
    precomputedStatus?: GitRepoInfo,
  ): Promise<string | null> {
    let config: ReturnType<typeof readConfig>;
    try {
      config = readConfig(this.cwd);
    } catch {
      return null;
    }
    if (!config.git.enabled) return null;
    const status = precomputedStatus ?? (await this.detect());
    if (!status.detected || !status.rootPath) return null;
    let real: string;
    try {
      real = fs.realpathSync(absPath);
    } catch {
      real = absPath;
    }
    const rel = path.relative(status.rootPath, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    try {
      const { stdout } = await this.git(['show', `${sha}:${rel}`], status.rootPath);
      return stdout;
    } catch {
      return null;
    }
  }

  /**
   * 0.1.118 read-only: HEAD status vs. upstream. Reuses `detect()`'s
   * branch/dirty rather than re-probing. `null` when git is disabled, no repo
   * is detected, or the branch is detached (no branch to compare). A non-null
   * result with `ahead`/`behind` both `null` means a repo + branch exist but
   * no upstream is configured — distinct from "no repo at all".
   *
   * `precomputedStatus` (0.1.119): pass an already-fetched `detect()` result
   * (e.g. from the `/api/git/status` route, which now merges this in) so a
   * single request doesn't pay for two full `detect()` probe rounds.
   */
  async statusAheadBehind(precomputedStatus?: GitRepoInfo): Promise<GitAheadBehindStatus | null> {
    let config: ReturnType<typeof readConfig>;
    try {
      config = readConfig(this.cwd);
    } catch {
      // Class-wide contract (see file header): never throw to the caller. A
      // malformed config.json mid-run must degrade to "can't tell", same as
      // every other failure mode here — this route is otherwise always-200.
      return null;
    }
    if (!config.git.enabled) return null;
    const status = precomputedStatus ?? (await this.detect());
    if (!status.detected || !status.rootPath || !status.branch) return null;
    const { ahead, behind } = await this.aheadBehindAt(status.rootPath, status.branch);
    // `null`/`null` = no upstream configured (or another failure) — repo and
    // branch are known, but no ahead/behind comparison is possible.
    return { branch: status.branch, isDirty: status.isDirty, ahead, behind };
  }

  /**
   * `git rev-list --left-right --count <branch>...@{upstream}` — counted
   * locally against the last fetched remote refs. Both `null` without an
   * upstream (or on any failure). Never throws.
   */
  private async aheadBehindAt(
    rootPath: string,
    branch: string,
  ): Promise<{ ahead: number | null; behind: number | null }> {
    try {
      const { stdout } = await this.git(
        ['rev-list', '--left-right', '--count', `${branch}...${branch}@{upstream}`],
        rootPath,
      );
      const [aheadStr, behindStr] = stdout.trim().split(/\s+/);
      const ahead = aheadStr !== undefined ? Number(aheadStr) : NaN;
      const behind = behindStr !== undefined ? Number(behindStr) : NaN;
      return {
        ahead: Number.isFinite(ahead) ? ahead : null,
        behind: Number.isFinite(behind) ? behind : null,
      };
    } catch {
      return { ahead: null, behind: null };
    }
  }

  /**
   * 2.1.10 (M28 m28aug01, dto `git-status-response`): ISO time of the last
   * fetch from a remote — the mtime of `FETCH_HEAD`, which git rewrites on
   * every fetch (ours or one run outside the app). `null` when the repository
   * never fetched or no repo is detected. A local read: no lock. Never throws.
   */
  async lastFetchedAt(precomputedStatus?: GitRepoInfo): Promise<string | null> {
    const status = precomputedStatus ?? (await this.detect());
    if (!status.detected || !status.rootPath) return null;
    try {
      const { stdout } = await this.git(['rev-parse', '--git-path', 'FETCH_HEAD'], status.rootPath);
      const fetchHead = path.resolve(status.rootPath, stdout.trim());
      return fs.statSync(fetchHead).mtime.toISOString();
    } catch {
      return null;
    }
  }

  /**
   * 2.1.10 (M28 5eyq89gb, endpoint `post-api-git-fetch`): fetch the refs of
   * the remote the current branch tracks, without touching HEAD or the
   * working tree. Guard chain, first match wins:
   *   1. gate — `config.git.enabled`, a detected repo and a NAMED branch;
   *      otherwise `skipped` (also detached/unborn HEAD).
   *   2. `no-upstream` — the current branch has no upstream.
   *   3. `busy` — the repository lock is taken by another git operation.
   *   4. `git fetch <remote>` (non-interactive, time-limited) → `fetched` with
   *      ahead/behind; a failure → `error` with git's message.
   * An agent turn or modified files do NOT block it: a fetch changes neither
   * HEAD nor the working tree, so it never triggers the reload contract. After
   * `fetched`, `git:status-changed { headChanged: false }`. Never throws.
   */
  async fetch(): Promise<GitFetchResponse> {
    const skipped: GitFetchResponse = { status: 'skipped', ahead: null, behind: null, message: null };
    let config: ReturnType<typeof readConfig>;
    try {
      config = readConfig(this.cwd);
    } catch {
      return skipped;
    }
    if (!config.git.enabled) return skipped;
    const root = await this.probeRoot();
    if (!root) return skipped;
    const branch = await this.currentBranch(root);
    if (!branch) return skipped;

    const remote = await this.upstreamRemote(root, branch);
    if (!remote) return { status: 'no-upstream', ahead: null, behind: null, message: null };

    const run = lockForKey(root).tryRun(async (): Promise<GitFetchResponse> => {
      try {
        await this.gitNetwork(['fetch', remote], root);
      } catch (err) {
        return { status: 'error', ahead: null, behind: null, message: errMessage(err) };
      }
      const { ahead, behind } = await this.aheadBehindAt(root, branch);
      return { status: 'fetched', ahead, behind, message: null };
    });
    // dto git-fetch-response: `message` carries git's text on `error` only — `busy` is `null`.
    if (!run) return { status: 'busy', ahead: null, behind: null, message: null };
    const result = await run;
    if (result.status === 'fetched') this.emitStatusChanged(false);
    return result;
  }

  /**
   * The remote the current branch tracks (`branch.<b>.remote`, with
   * `branch.<b>.merge` set) — `null` when the branch has no upstream. Read from
   * config rather than `@{upstream}`, which fails until the remote-tracking ref
   * has been fetched once.
   */
  private async upstreamRemote(root: string, branch: string): Promise<string | null> {
    const get = (key: string) =>
      this.git(['config', '--get', key], root)
        .then((r) => r.stdout.trim() || null)
        .catch(() => null);
    const [remote, merge] = await Promise.all([get(`branch.${branch}.remote`), get(`branch.${branch}.merge`)]);
    return remote && merge ? remote : null;
  }

  /**
   * 2.1.10 (M28 9j5dmxyp / e5l1zqxa, endpoint `post-api-git-sync`): pull the
   * upstream's commits into HEAD — by a fast-forward or by a conflict-free
   * merge commit — or change nothing and say why. Never a rebase, never a
   * conflict resolution, never an intermediate repository state. Guard chain,
   * first match wins:
   *   1. gate (as `fetch()`) → `skipped` (also detached/unborn HEAD);
   *   2. `no-upstream`;
   *   3. `busy` — the repository lock is taken;
   *   4. fetch of the upstream's remote (non-interactive, time-limited) —
   *      a failure → `error` with git's message;
   *   5. `behind = 0` → `up-to-date`, also when `ahead > 0` (sending is push's job);
   *   6. `busy` — an agent turn mutating disk, checked right before HEAD moves;
   *   7. `ahead = 0` → fast-forward; 8. otherwise → merge on divergence.
   * After `fast-forwarded`/`merged`: the changed paths are labelled
   * `origin: 'server'` (M40) BEFORE HEAD moves, then HEAD moves, then
   * `git:status-changed { headChanged: true }`; the caller then runs the M31
   * reload contract. Every other result except `skipped` and `no-upstream`
   * emits `headChanged: false` (the fetch moved remote refs). Never throws.
   */
  async sync(): Promise<GitSyncResponse> {
    const skipped = syncResult('skipped');
    let config: ReturnType<typeof readConfig>;
    try {
      config = readConfig(this.cwd);
    } catch {
      return skipped;
    }
    if (!config.git.enabled) return skipped;
    const root = await this.probeRoot();
    if (!root) return skipped;
    const branch = await this.currentBranch(root);
    if (!branch) return skipped;

    const remote = await this.upstreamRemote(root, branch);
    if (!remote) return syncResult('no-upstream');

    const run = lockForKey(root).tryRun(() => this.syncLocked(root, branch, remote));
    if (!run) {
      this.emitStatusChanged(false);
      return syncResult('busy');
    }
    let outcome: { response: GitSyncResponse; headChanged: boolean };
    try {
      outcome = await run;
    } catch (err) {
      outcome = { response: syncResult('error', { message: errMessage(err) }), headChanged: false };
    }
    this.emitStatusChanged(outcome.headChanged);
    return outcome.response;
  }

  /** `sync()` from step 4 on, under the repository lock. */
  private async syncLocked(
    root: string,
    branch: string,
    remote: string,
  ): Promise<{ response: GitSyncResponse; headChanged: boolean }> {
    const unchanged = (response: GitSyncResponse) => ({ response, headChanged: false });
    try {
      await this.gitNetwork(['fetch', remote], root);
    } catch (err) {
      return unchanged(syncResult('error', { message: errMessage(err) }));
    }

    let headSha: string;
    let upstreamSha: string;
    let upstreamName: string;
    try {
      headSha = (await this.git(['rev-parse', '--verify', 'HEAD'], root)).stdout.trim();
      upstreamSha = (await this.git(['rev-parse', '--verify', `${branch}@{upstream}`], root)).stdout.trim();
      upstreamName = (await this.git(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], root)).stdout.trim();
    } catch (err) {
      return unchanged(syncResult('error', { message: errMessage(err) }));
    }

    const { ahead, behind } = await this.aheadBehindAt(root, branch);
    if (ahead === null || behind === null) {
      return unchanged(syncResult('error', { message: 'Could not compare the branch with its upstream.' }));
    }
    if (behind === 0) return unchanged(syncResult('up-to-date'));

    if (this.hasInFlightTurn()) return unchanged(syncResult('busy'));

    if (ahead === 0) return this.syncFastForward(root, headSha, upstreamSha);
    return this.syncMerge(root, branch, headSha, upstreamSha, upstreamName);
  }

  /**
   * M28 hu0spaq8 — no separate dirty-tree block: local changes to files the
   * incoming commits do not touch stay as they are; only a collision with an
   * incoming change refuses (a tracked change or an untracked file) →
   * `dirty-blocked` with those paths, nothing changed.
   */
  private async syncFastForward(
    root: string,
    headSha: string,
    upstreamSha: string,
  ): Promise<{ response: GitSyncResponse; headChanged: boolean }> {
    const incoming = await this.changedPaths(root, headSha, upstreamSha);
    const local = new Set([...(await this.trackedChanges(root)), ...(await this.untrackedFiles(root))]);
    const collisions = incoming.filter((p) => local.has(p));
    if (collisions.length > 0) {
      return { response: syncResult('dirty-blocked', { paths: collisions }), headChanged: false };
    }
    return this.moveHeadTo(root, upstreamSha, incoming, 'fast-forwarded');
  }

  /**
   * M28 5vgl0yhy — merge on divergence, each refusal leaving the repository
   * untouched: modified tracked files → `dirty-blocked` (a merge commit needs a
   * clean tree); new files in the `releases` root on both sides since the
   * merge base → `diverged` / `releases-on-both-sides` (the reign rule only
   * survives a merge with new release markers on at most one side); a content
   * conflict → `diverged` / `conflicts` (decided by `git merge-tree` in memory:
   * no merge in progress, no conflict markers on disk). Otherwise the merge
   * commit `Merge <upstream> into <branch>` is built off-tree and HEAD is
   * fast-forwarded onto it → `merged`.
   */
  private async syncMerge(
    root: string,
    branch: string,
    headSha: string,
    upstreamSha: string,
    upstreamName: string,
  ): Promise<{ response: GitSyncResponse; headChanged: boolean }> {
    const unchanged = (response: GitSyncResponse) => ({ response, headChanged: false });

    const tracked = await this.trackedChanges(root);
    if (tracked.length > 0) return unchanged(syncResult('dirty-blocked', { paths: tracked }));

    let mergeBase: string;
    try {
      mergeBase = (await this.git(['merge-base', headSha, upstreamSha], root)).stdout.trim();
    } catch (err) {
      return unchanged(syncResult('error', { message: errMessage(err) }));
    }
    const releasesSpec = this.releasesPathspec(root);
    if (releasesSpec !== null) {
      const [localNew, remoteNew] = await Promise.all([
        this.changedPaths(root, mergeBase, headSha, ['--diff-filter=A'], releasesSpec),
        this.changedPaths(root, mergeBase, upstreamSha, ['--diff-filter=A'], releasesSpec),
      ]);
      if (localNew.length > 0 && remoteNew.length > 0) {
        return unchanged(syncResult('diverged', { reason: 'releases-on-both-sides' }));
      }
    }

    let tree: string;
    try {
      const { stdout } = await this.git(
        ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', headSha, upstreamSha],
        root,
      );
      tree = splitNul(stdout)[0] ?? '';
    } catch (err) {
      const e = err as { code?: unknown; stdout?: string };
      if (e.code === 1 && typeof e.stdout === 'string') {
        // Exit 1 = conflicts: `<tree>\0<path>\0<path>\0\0` — nothing was written to the worktree.
        const [, ...rest] = e.stdout.split('\0');
        const end = rest.indexOf('');
        const conflicted = [...new Set(end === -1 ? rest : rest.slice(0, end))];
        return unchanged(syncResult('diverged', { reason: 'conflicts', paths: conflicted }));
      }
      return unchanged(syncResult('error', { message: errMessage(err) }));
    }
    if (!tree) return unchanged(syncResult('error', { message: 'git merge-tree returned no tree.' }));

    let mergeSha: string;
    try {
      const message = `Merge ${upstreamName} into ${branch}`;
      mergeSha = (
        await this.git(['commit-tree', tree, '-p', headSha, '-p', upstreamSha, '-m', message], root)
      ).stdout.trim();
    } catch (err) {
      return unchanged(syncResult('error', { message: errMessage(err) }));
    }
    const incoming = await this.changedPaths(root, headSha, mergeSha);
    return this.moveHeadTo(root, mergeSha, incoming, 'merged');
  }

  /**
   * The HEAD change of a sync, in the M40 order: label the paths that differ
   * between the old and the new HEAD (`origin: 'server'`) on the current
   * context instance → move HEAD (`git merge --ff-only`, which refuses before
   * touching anything when it would overwrite a local change or an untracked
   * file — mapped to `dirty-blocked`) → re-label, so the provider's
   * late-arriving events still find a live label.
   */
  private async moveHeadTo(
    root: string,
    target: string,
    changed: string[],
    okStatus: 'fast-forwarded' | 'merged',
  ): Promise<{ response: GitSyncResponse; headChanged: boolean }> {
    this.labelHeadChange(root, changed);
    try {
      await this.git(['merge', '--ff-only', '--no-edit', target], root);
    } catch (err) {
      const blocked = overwrittenPaths(`${rawStderr(err)}\n${(err as { stdout?: string })?.stdout ?? ''}`);
      if (blocked.length > 0) {
        return { response: syncResult('dirty-blocked', { paths: blocked }), headChanged: false };
      }
      return { response: syncResult('error', { message: errMessage(err) }), headChanged: false };
    }
    this.labelHeadChange(root, changed);
    return { response: syncResult(okStatus), headChanged: true };
  }

  /** M40 j37qjvvh: hand the repository-relative `relPaths` to the origin marker as absolute paths. */
  private labelHeadChange(root: string, relPaths: string[]): void {
    if (!this.markHeadChangeOrigin || relPaths.length === 0) return;
    try {
      this.markHeadChangeOrigin(relPaths.map((p) => path.join(root, p)));
    } catch (err) {
      console.warn('[git] origin labelling before a HEAD change failed:', errMessage(err));
    }
  }

  /** Repository-relative paths differing between two commits (`git diff --name-only`). Never throws (→ `[]`). */
  private async changedPaths(
    root: string,
    from: string,
    to: string,
    extra: string[] = [],
    pathspec?: string,
  ): Promise<string[]> {
    const args = ['diff', '--name-only', '-z', '--no-renames', ...extra, from, to];
    if (pathspec !== undefined) args.push('--', pathspec);
    return this.git(args, root)
      .then((r) => splitNul(r.stdout))
      .catch(() => []);
  }

  /** Tracked files modified or staged against HEAD (repository-relative). Never throws. */
  private async trackedChanges(root: string): Promise<string[]> {
    return this.git(['--no-optional-locks', 'diff', '--name-only', '-z', '--no-renames', 'HEAD'], root)
      .then((r) => splitNul(r.stdout))
      .catch(() => []);
  }

  /** Untracked, not-ignored files (repository-relative — run at the root). Never throws. */
  private async untrackedFiles(root: string): Promise<string[]> {
    return this.git(['ls-files', '--others', '--exclude-standard', '-z'], root)
      .then((r) => splitNul(r.stdout))
      .catch(() => []);
  }

  /** The `releases` root as a repository-relative pathspec; `null` when it lies outside the worktree. */
  private releasesPathspec(root: string): string | null {
    const releasesRoot = SYSTEM_ROOTS.find((r) => r.kind === 'releases');
    if (!releasesRoot) return null;
    const real = realpathOfNearestAncestor(path.resolve(this.cwd, releasesRoot.dir));
    if (!real) return null;
    const rel = path.relative(root, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return rel === '' ? '.' : rel.split(path.sep).join('/');
  }

  /** Local branch names (`git branch --format=%(refname:short)`) at an already-detected `rootPath`. */
  private async listBranchesAt(rootPath: string): Promise<string[]> {
    return this.git(['branch', '--format=%(refname:short)'], rootPath)
      .then((r) =>
        r.stdout
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .catch(() => []);
  }

  /**
   * 0.1.123 read-only: local branches for the interactive git badge dropdown +
   * the release-plan commit-target picker. `current` is `null` on detached
   * HEAD. `branches` is non-empty even in detached HEAD, so the UI can offer a
   * way out. Never throws — degrades to `{ current: null, branches: [] }` when
   * git is disabled or no repo is detected. Uses `probeRoot()`/`currentBranch()`
   * rather than the full `detect()` — this doesn't need the remote URL or a
   * working-tree status probe.
   */
  async listBranches(): Promise<GitBranchesResponse> {
    let config: ReturnType<typeof readConfig>;
    try {
      config = readConfig(this.cwd);
    } catch {
      return { current: null, branches: [] };
    }
    if (!config.git.enabled) return { current: null, branches: [] };
    const rootPath = await this.probeRoot();
    if (!rootPath) return { current: null, branches: [] };
    const [current, branches] = await Promise.all([this.currentBranch(rootPath), this.listBranchesAt(rootPath)]);
    return { current, branches };
  }

  /**
   * 0.1.123: switch HEAD/working tree to an EXISTING local branch. Never
   * throws — every failure maps to a `status`, no HTTP error. Does not create
   * branches or tags. Guard chain, first match wins:
   *   1. `'skipped'`   — git master switch off or no repo.
   *   2. `'busy'`      — an in-flight agent turn is mutating disk.
   *   3. `'dirty-blocked'` — tracked modified/staged files exist (untracked
   *      files alone do NOT block — checked via `--untracked-files=no`).
   *   4. `'not-found'` — `branch` isn't a local branch.
   *   5. `'switched'`  — success. `'error'` if git itself refuses the checkout
   *      (e.g. an untracked-file collision) despite the pre-checks passing —
   *      that case must NOT be reported as `'dirty-blocked'`.
   */
  async checkout(branch: string): Promise<GitCheckoutResponse> {
    let config: ReturnType<typeof readConfig>;
    try {
      config = readConfig(this.cwd);
    } catch {
      return { status: 'skipped', branch: null, message: null };
    }
    if (!config.git.enabled) return { status: 'skipped', branch: null, message: null };

    // Doesn't need detect()'s remote-URL/status probe — just the root, plus
    // its own dirty check below (narrower than detect()'s isDirty).
    const root = await this.probeRoot();
    if (!root) return { status: 'skipped', branch: null, message: null };

    if (this.hasInFlightTurn()) {
      return { status: 'busy', branch: null, message: BUSY_MESSAGE };
    }

    // 2.1.10 (M28 ezudoqef): a sidebar operation REFUSES with `busy` while
    // another git operation holds the repository lock — the second cause of
    // `busy`, same result and same hint as an in-flight turn.
    const locked = lockForKey(root).tryRun(() => this.checkoutLocked(root, branch));
    if (!locked) return { status: 'busy', branch: null, message: BUSY_MESSAGE };
    const result = await locked;
    // 2.1.10 (M28 1svflc6b, M49 7xmafzkd): the same sequence as a sync that
    // moved HEAD — label (inside the lock, before the switch) → switch → event.
    if (result.status === 'switched') this.emitStatusChanged(true);
    return result;
  }

  private async checkoutLocked(root: string, branch: string): Promise<GitCheckoutResponse> {
    // Tracked modified/staged files only — `--untracked-files=no` excludes
    // bare `??` entries, so an untracked file alone never blocks the switch.
    const dirty = await this.git(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=no'], root)
      .then((r) => r.stdout.trim().length > 0)
      .catch(() => false);
    if (dirty) {
      return {
        status: 'dirty-blocked',
        branch: null,
        message: 'Commit or stash your changes before switching branches.',
      };
    }

    const branches = await this.listBranchesAt(root);
    if (!branches.includes(branch)) {
      return { status: 'not-found', branch: null, message: `Branch "${branch}" was not found.` };
    }

    // Best-effort re-check immediately before the mutating call: narrows (does
    // not close) the TOCTOU window between the busy-check above and the actual
    // checkout — the guard chain is explicitly "first match wins", not a lock.
    if (this.hasInFlightTurn()) {
      return { status: 'busy', branch: null, message: BUSY_MESSAGE };
    }

    // 2.1.10 (M40 j37qjvvh): label the paths differing between the current and
    // the target branch as caused by the server, on the current context
    // instance, BEFORE HEAD moves — then again right after, for late events.
    const changed = await this.changedPaths(root, 'HEAD', `refs/heads/${branch}`);
    this.labelHeadChange(root, changed);
    try {
      await this.git(['checkout', branch], root);
      this.labelHeadChange(root, changed);
      return { status: 'switched', branch, message: null };
    } catch (err) {
      return { status: 'error', branch: null, message: errMessage(err) };
    }
  }
}

/** Fresh scratch-index path under the OS tmpdir — never the repo's real `.git/index`. */
function tmpIndexPath(): string {
  return path.join(
    os.tmpdir(),
    `c4s-git-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

/** Best-effort delete of a scratch index file — a leaked one is harmless. */
function cleanupTmpIndex(p: string): void {
  try {
    fs.rmSync(p, { force: true });
  } catch {
    // best-effort cleanup
  }
}

/** 2.1.10: a `GitSyncResponse` with every field present (`null` unless given). */
function syncResult(
  status: GitSyncResponse['status'],
  extra: Partial<Omit<GitSyncResponse, 'status'>> = {},
): GitSyncResponse {
  return { status, paths: null, reason: null, message: null, ...extra };
}

/** Entries of a `-z` (NUL-terminated) git listing. */
function splitNul(stdout: string): string[] {
  return stdout.split('\0').filter((s) => s.length > 0);
}

/**
 * The paths git lists when it refuses a merge/checkout because it would
 * overwrite local changes or untracked files ("…would be overwritten by
 * merge:" followed by tab-indented paths).
 */
function overwrittenPaths(output: string): string[] {
  const paths: string[] = [];
  let inList = false;
  for (const line of output.split('\n')) {
    if (/would be overwritten by/.test(line)) {
      inList = true;
      continue;
    }
    if (inList && /^\t/.test(line)) {
      const p = line.trim();
      if (p) paths.push(p);
      continue;
    }
    inList = false;
  }
  return [...new Set(paths)];
}

function errMessage(err: unknown): string {
  // execFile rejections carry the combined stderr; prefer it over the generic
  // "Command failed" wrapper for a useful warning toast.
  const stderr = rawStderr(err);
  if (stderr) return stderr;
  return err instanceof Error ? err.message : String(err);
}

/**
 * 2.1.10 (M28 sw1u84nn): git refused the push because the remote branch is not
 * an ancestor of the pushed one — `! [rejected] … (non-fast-forward)` when the
 * remote commits are known locally, `(fetch first)` when they are not. A hook
 * refusal (`[remote rejected]`) or a tag clash (`(already exists)`) is not one.
 */
function isNonFastForwardRejection(err: unknown): boolean {
  const text = `${rawStderr(err)}\n${err instanceof Error ? err.message : ''}`;
  return /!\s*\[rejected\][^\n]*\((?:non-fast-forward|fetch first)\)/.test(text);
}

/** Raw stderr from an `execFile` rejection, or `''` when the failure carries none. */
function rawStderr(err: unknown): string {
  return (err as { stderr?: string })?.stderr?.trim() ?? '';
}

/**
 * `realpath` of `p`, tolerating a missing tail: walks up to the nearest existing
 * ancestor, realpaths it and re-appends the missing segments. `null` only when
 * nothing up to the filesystem root resolves.
 */
function realpathOfNearestAncestor(p: string): string | null {
  const tail: string[] = [];
  let current = path.resolve(p);
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}
