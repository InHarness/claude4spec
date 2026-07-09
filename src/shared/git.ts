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
