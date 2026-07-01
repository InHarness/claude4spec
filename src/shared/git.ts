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
