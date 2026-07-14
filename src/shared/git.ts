/**
 * M28 Git Sync — DTOs shared between server and client.
 *
 * Git sync is best-effort: every operation wraps a missing/broken git in a
 * non-throwing result. None of these shapes are persisted — the `gitSync`
 * fields ride the synchronous create/push responses only (see brief 0.1.38).
 */

import { slugify } from './slug.js';

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

/**
 * 0.1.124: additive payload of a `status: 'error'` `GitCommitResult`/
 * `GitPushResult` — everything the client needs to render the
 * `GitErrorRecoveryModal` and seed a "Fix it with Agent" chat thread.
 * `intentPrompt` is fully composed server-side (operation, paths/roots, the
 * raw git error, and safe-recovery instructions); the client only has to pass
 * it verbatim to `startSeededThread`.
 */
export interface GitErrorRecovery {
  operation: 'commit-on-release' | 'pull' | 'push';
  /** Short human-readable summary of what went wrong (for the modal's collapsed state). */
  reason: string;
  /** Raw stderr from the failed git invocation (for the modal's expandable detail block). */
  gitStderr: string;
  /** Pre-composed prompt for `startSeededThread(recovery.intentPrompt, { autoSubmit: true })`. */
  intentPrompt: string;
  /**
   * 0.1.125: additive — narrows WHY a commit-target/switch operation failed,
   * orthogonal to `operation` (WHAT action was running). Absent for ordinary
   * git failures (e.g. a plain commit/push error) predating commit-target
   * support. All kinds still map onto `status: 'error'` — no new status
   * values were introduced.
   */
  kind?: 'branch-missing' | 'base-missing' | 'switch-failed' | 'switch-dirty';
}

export interface GitCommitResult {
  status: GitCommitStatus;
  message?: string;
  /** Present only when `status === 'error'`. */
  recovery?: GitErrorRecovery;
  /**
   * 0.1.125: branch the commit actually landed on (or was targeting when a
   * post-commit switch failed). Populated on `status: 'committed'`, and also
   * on `status: 'error'` when the commit itself succeeded but a subsequent
   * `switchAfterRelease` attempt failed (`recovery.kind` is
   * `'switch-failed'`/`'switch-dirty'` in that case — the commit is durable).
   */
  branch?: string;
  /** 0.1.125: whether HEAD was switched to `branch` after the commit (`config.git.switchAfterRelease`). */
  switched?: boolean;
}

export interface GitPushResult {
  status: GitPushStatus;
  message?: string;
  /** Present only when `status === 'error'`. */
  recovery?: GitErrorRecovery;
  /** 0.1.125: the branch that was pushed. */
  branch?: string;
}

/**
 * 0.1.124: shared shape for the `gitSync` field riding the synchronous
 * create/update-release and push responses — `CreateReleaseResponse`,
 * `UpdateReleaseResponse`, `ReleasePushResponse`. `null` when git is off, no
 * repo was detected, or (update) the request didn't trigger a git operation
 * at all (e.g. a rename with no `assignUnreleased`).
 *
 * 0.1.125: `branch`/`switched` added — see `GitCommitResult`/`GitPushResult`.
 */
export type GitSyncField<TStatus extends string> =
  | { status: TStatus; message?: string; recovery?: GitErrorRecovery; branch?: string; switched?: boolean }
  | null;

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

/** 0.1.125: `config.git.commitTarget.mode` — see `GitCommitTargetConfig` in server config. */
export type GitCommitTargetMode = 'current' | 'named' | 'new';

/**
 * 0.1.125: substitute `{release_slug}`/`{release_name}`/`{date}` into a
 * `commitTarget.template`. Pure, isomorphic — shared between the server
 * (`git.ts`'s real `'new'`-mode branch naming, and the PATCH /api/config
 * route's preview-render check) and the client (`GitSection.tsx`'s live
 * template preview), so the two never drift out of sync. Only dependency is
 * `slugify`, also shared.
 *
 * A SINGLE regex pass over the ORIGINAL `template` string — critical: naive
 * sequential `.replace()` calls would let one placeholder's substituted text
 * get re-matched by a later `.replace()` (e.g. a release named
 * `Sprint {date} Wrapup` would have its own literal `{date}` text rewritten
 * a second time by the `{date}` substitution). A single `String.replace`
 * with a global regex only ever matches against the ORIGINAL input, never
 * against already-substituted output, so this is immune to that.
 */
export function renderCommitTargetTemplate(
  template: string,
  ctx: { releaseName: string; date: string },
): string {
  return template.replace(/\{release_slug\}|\{release_name\}|\{date\}/g, (token) => {
    switch (token) {
      case '{release_slug}':
        return slugify(ctx.releaseName);
      case '{release_name}':
        return ctx.releaseName;
      case '{date}':
        return ctx.date;
      default:
        return token;
    }
  });
}

/**
 * 0.1.125: local (NOT UTC) calendar date as `YYYY-MM-DD`, for the `{date}`
 * commit-target placeholder — a user's "today" shouldn't flip a day
 * early/late just because UTC has already turned over (e.g. `toISOString()`
 * at 9pm US Pacific already reports the next UTC day). Shared so the
 * server's real commit and the client's live template preview always agree.
 */
export function localDateYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
