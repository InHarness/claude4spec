/**
 * M28 Git Sync — DTOs shared between server and client.
 *
 * Git sync is best-effort: every operation wraps a missing/broken git in a
 * non-throwing result. None of these shapes are persisted — the `gitSync`
 * fields ride the synchronous create/push responses only (see brief 0.1.38).
 */

/** Result of `gitService.detect()`, exposed by `GET /api/git/status`. */
export interface GitStatusResponse {
  /** `true` when a releasable root is inside a git worktree and `git` is on PATH. */
  detected: boolean;
  /** Worktree root (`git rev-parse --show-toplevel`); `null` when not detected. */
  rootPath: string | null;
  /** URL of remote `origin`; `null` when no origin or not detected. */
  remoteUrl: string | null;
  /** Current branch; `null` when not detected or detached HEAD. */
  branch: string | null;
  /** `true` when `git status --porcelain` is non-empty. */
  isDirty: boolean;
  /**
   * 0.1.119: commits ahead of upstream (from `gitService.statusAheadBehind()`,
   * merged in by the `/api/git/status` route only — other `detect()` callers
   * don't populate this). Absent/`null` when not detected, detached HEAD, or
   * no upstream configured for the branch.
   */
  ahead?: number | null;
  /** 0.1.119: commits behind upstream — see `ahead`. */
  behind?: number | null;
}

/** `'committed'` = success; `'nothing-to-commit'` = nothing staged (not an error);
 *  `'skipped'` = repo detected but commit could not run (e.g. detached HEAD);
 *  `'error'` = attempted and failed. */
export type GitCommitStatus = 'committed' | 'nothing-to-commit' | 'skipped' | 'error';

export type GitPushStatus = 'pushed' | 'nothing-to-push' | 'skipped' | 'error';

export interface GitCommitResult {
  status: GitCommitStatus;
  message?: string;
}

export interface GitPushResult {
  status: GitPushStatus;
  message?: string;
}

/**
 * 0.1.118: result of `gitService.diffRefs()` — a file-level `git diff
 * --name-status <a>..<b>` between two release-anchor commits. Gated on
 * `config.git.enabled`; never throws (returns `null` on any failure). `path`
 * is an ABSOLUTE filesystem path (git reports repo-root-relative paths
 * internally, resolved here so callers never re-derive the repo root).
 */
export interface GitRefDiff {
  files: Array<{ path: string; status: 'A' | 'M' | 'D' | 'R' }>;
}

/**
 * 0.1.118: result of `gitService.statusAheadBehind()` — read-only HEAD status
 * vs. upstream, gated on `config.git.enabled`. Distinct from
 * `GitStatusResponse` (the `detect()` shape, unconditionally available):
 * `null` = no repo detected or git disabled; a non-null result with
 * `ahead`/`behind` both `null` = a repo with no upstream configured for the
 * current branch.
 */
export interface GitAheadBehindStatus {
  branch: string | null;
  isDirty: boolean;
  ahead: number | null;
  behind: number | null;
}

/**
 * 0.1.123: result of `gitService.listBranches()`, exposed by `GET /api/git/branches`.
 * Local branches only — no remote-tracking `origin/*`. Never throws; degrades to
 * `{ current: null, branches: [] }` when git is disabled or no repo is detected.
 */
export interface GitBranchesResponse {
  /** `git rev-parse --abbrev-ref HEAD`; `null` on detached HEAD, no repo, or git disabled. */
  current: string | null;
  /** `git branch --format=%(refname:short)`. Non-empty in detached HEAD — branches
   *  still exist, there's just no current one, so the UI can offer a way out. */
  branches: string[];
}

/**
 * 0.1.123: result of `gitService.checkout()`, exposed by `POST /api/git/checkout`.
 * `'switched'` = success; `'dirty-blocked'` = tracked modified/staged files exist
 * (a pre-check, NOT derived from the actual checkout's exit code); `'not-found'` =
 * branch doesn't exist locally; `'busy'` = an in-flight agent turn is mutating disk;
 * `'skipped'` = git master switch off or no repo detected; `'error'` = git itself
 * failed the checkout (e.g. an untracked-file collision) despite the pre-checks
 * passing. Never a non-200 HTTP response — every outcome, including failure, rides
 * `status`/`message` here.
 */
export type GitCheckoutStatus = 'switched' | 'dirty-blocked' | 'not-found' | 'skipped' | 'busy' | 'error';

export interface GitCheckoutResponse {
  status: GitCheckoutStatus;
  /** New current branch on `'switched'`; `null` for every other status. */
  branch: string | null;
  /** Human-readable detail for a toast/hint; `null` on `'switched'` and `'skipped'`. */
  message: string | null;
}
