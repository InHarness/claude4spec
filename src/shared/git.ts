/**
 * M28 Git Sync — DTOs shared between server and client.
 *
 * Git sync is best-effort: every operation wraps a missing/broken git in a
 * non-throwing result. None of these shapes are persisted — the `gitSync`
 * fields ride the synchronous create/push responses only (see brief 0.1.38).
 */

import { slugify } from './slug.js';

/**
 * Result of `gitService.detect()` — the repository probe alone, without the
 * upstream measurement. `GET /api/git/status` widens it to `GitStatusResponse`.
 */
export interface GitRepoInfo {
  /** `true` when a release-flag root is inside a git worktree and `git` is on PATH. */
  detected: boolean;
  /** Worktree root (`git rev-parse --show-toplevel`); `null` when not detected. */
  rootPath: string | null;
  /** URL of remote `origin`; `null` when no origin or not detected. */
  remoteUrl: string | null;
  /**
   * Current branch; `null` when not detected, on detached HEAD or an unborn
   * branch (fresh repo, 0 commits). 2.1.14: with `null` the release push and a
   * `current`-mode release commit do not run (`gitSync: null`), the pull commit
   * answers `skipped`; `named`/`new` release commits run on detached HEAD too.
   */
  branch: string | null;
  /** `true` when `git status --porcelain` is non-empty. */
  isDirty: boolean;
}

/**
 * `GET /api/git/status` (dto `git-status-response`). 2.1.10 (M28 m28aug01):
 * the status ALWAYS carries ahead/behind vs. upstream and the last fetch time —
 * no longer optional. Status is a local read: it goes stale after every M28
 * operation (each emits `git:status-changed`) and after changes outside the
 * app (caught by a refetch on window focus).
 */
export interface GitStatusResponse extends GitRepoInfo {
  /** Local commits the upstream lacks, counted against the last fetched remote refs.
   *  `null` without an upstream, on detached HEAD, or when not detected. */
  ahead: number | null;
  /** Upstream commits the current branch lacks — see `ahead`; current after a fetch. */
  behind: number | null;
  /** ISO 8601 time of the last fetch from a remote; `null` when the repository never fetched or not detected. */
  lastFetchedAt: string | null;
}

/**
 * 2.1.10 (M28 `fetch()`, dto `git-fetch-response`) — result of
 * `POST /api/git/fetch`. Always a 200 body; every field is present.
 * `fetched` — remote refs fetched; `skipped` — git off, no repo or no named
 * branch (detached/unborn HEAD); `no-upstream` — the current branch has no
 * upstream; `busy` — another git operation holds the repository lock;
 * `error` — git failed (network, auth, timeout), its message in `message`.
 */
export type GitFetchStatus = 'fetched' | 'skipped' | 'no-upstream' | 'busy' | 'error';

export interface GitFetchResponse {
  status: GitFetchStatus;
  /** Number only on `fetched`; `null` otherwise. */
  ahead: number | null;
  /** Number only on `fetched`; `null` otherwise. */
  behind: number | null;
  /** Git's message on `error`; `null` otherwise. */
  message: string | null;
}

/**
 * 2.1.10 (M28 `sync()`, dto `git-sync-response`) — result of
 * `POST /api/git/sync`: pull the upstream's commits into HEAD by a fast-forward
 * or a conflict-free merge commit, or change nothing and say why. Always a 200
 * body; every field is present.
 * `up-to-date` — the upstream has no new commits (also when the branch is ahead);
 * `fast-forwarded` — HEAD moved to the upstream; `merged` — a merge commit was
 * created; `dirty-blocked` — local changes block the operation, nothing changed
 * (`paths`); `diverged` — a divergence sync does not merge, nothing changed
 * (`reason`, `paths` on `conflicts`); `skipped` — git off, no repo or
 * detached/unborn HEAD; `no-upstream` — the branch has no upstream; `busy` —
 * another git operation or an agent turn mutating disk is running; `error` —
 * git failed, its message in `message`.
 * After `fast-forwarded`/`merged` the server runs the `ProjectContext` reload
 * contract (M31), so the response carries no status snapshot.
 */
export type GitSyncStatus =
  | 'up-to-date'
  | 'fast-forwarded'
  | 'merged'
  | 'dirty-blocked'
  | 'diverged'
  | 'skipped'
  | 'no-upstream'
  | 'busy'
  | 'error';

export type GitSyncDivergedReason = 'conflicts' | 'releases-on-both-sides';

export interface GitSyncResponse {
  status: GitSyncStatus;
  /** Blocking paths on `dirty-blocked`, conflicted files on `diverged`/`conflicts`
   *  (repository-relative); `null` otherwise, also on `releases-on-both-sides`. */
  paths: string[] | null;
  /** Why on `diverged`; `null` for every other status. */
  reason: GitSyncDivergedReason | null;
  /** Git's message on `error`; `null` otherwise. */
  message: string | null;
}

/** `'committed'` = success;`'nothing-to-commit'` = nothing staged (not an error);
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
   *
   * 2.1.10 (M28 eu1rffp6/sw1u84nn): `'non-fast-forward'` — operation `push`,
   * the remote rejected the push because it has commits the local branch
   * lacks. The `git-sync-recover` window offers `Sync` instead of the agent.
   *
   * 2.1.47 (M28 eu1rffp6), both from the shadow acceptance, operation
   * `commit-on-release`, a merge left open (`MERGE_HEAD`):
   * `'merge-open'` — the release commit (the merge commit) failed, the
   * release exists; `'merge-abort-failed'` — undoing the merge failed, no
   * release exists.
   */
  kind?:
    | 'branch-missing'
    | 'base-missing'
    | 'switch-failed'
    | 'switch-dirty'
    | 'non-fast-forward'
    | 'merge-open'
    | 'merge-abort-failed';
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
 * `UpdateReleaseResponse`, `ReleasePushResponse`. 2.1.14: on create and push
 * `null` means the gated entry (`commitOnRelease` / `pushOnPush`) did not let
 * the operation through (git off, push-sync off, no repo, detached HEAD); on
 * update `null` means no pull ran at all (e.g. a rename with no
 * `assignUnreleased`) — git off / no repo there answer `skipped`. The release
 * and push pages react only to `status: 'error'` (`surfaceGitSync`).
 *
 * 0.1.125: `branch`/`switched` added — see `GitCommitResult`/`GitPushResult`.
 */
export type GitSyncField<TStatus extends string> =
  | { status: TStatus; message?: string; recovery?: GitErrorRecovery; branch?: string; switched?: boolean }
  | null;

/**
 * 0.1.118: result of `gitService.diffRefs()` — a file-level `git diff
 * --name-status <a> <b>` between two release-anchor commits (2.1.46: the right
 * side may also be a tree SHA, e.g. a `mergeTree` result). Gated on
 * `config.git.enabled`; never throws (returns `null` on any failure). `path`
 * is an ABSOLUTE filesystem path (git reports repo-root-relative paths
 * internally, resolved here so callers never re-derive the repo root).
 */
export interface GitRefDiff {
  files: Array<{ path: string; status: 'A' | 'M' | 'D' | 'R' }>;
}

/**
 * 2.1.46 (M28 eu1rffp6 / dadc3w49): one entry of `gitService.listShadows()` — a
 * shadow, i.e. someone else's not-yet-accepted version of the specification
 * whose commits live in a ref of the `refs/runs/` namespace.
 */
export interface GitShadow {
  /** The ref name without the `refs/runs/` prefix, e.g. `'<runId>/spec'`. */
  id: string;
  /** SHA of the commit the ref points at. */
  tipSha: string;
  /** ISO 8601 committer time of the tip commit. */
  tipCommittedAt: string;
  /** Subject line of the tip commit. */
  tipSubject: string;
}

/**
 * 2.1.46 (dto `git-shadows-response`) — `GET /api/git/shadows`: the result of
 * `gitService.listShadows()` as a DTO. Git off or no repository
 * (`listShadows() === null`) → an empty list.
 */
export interface GitShadowsResponse {
  shadows: GitShadow[];
}

/**
 * 2.1.46 (M28 eu1rffp6): result of `gitService.mergeTree()` — a trial merge
 * (`git merge-tree --write-tree`) that touches neither the working tree, HEAD,
 * the index nor any ref. `unsupported` comes from reading git's version
 * (< 2.38), not from a failing command; any other failure is `error`.
 */
export type GitMergeTreeResult =
  | { status: 'clean'; tree: string }
  | { status: 'conflicts'; paths: string[] }
  | { status: 'unsupported' }
  | { status: 'error' };

/**
 * 2.1.47 (M28 es9w55mr): the refusals shared by the merge primitives of the
 * shadow acceptance (`pendingChanges`, `mergeIntoIndex`, `abortMerge`) —
 * `skipped`: git off or no repository; `no-branch`: HEAD has no named branch;
 * `busy`: the repository lock is taken and the caller passed no live handle
 * of it. None of these results ever throws or rides a REST response.
 */
export type GitMergePrimitiveRefusal = { status: 'skipped' } | { status: 'no-branch' } | { status: 'busy' };

/** `pendingChanges(pathspecs)` — `dirty` with the repository-relative paths, `clean` when none. */
export type GitPendingChangesResult =
  | GitMergePrimitiveRefusal
  | { status: 'clean' }
  | { status: 'dirty'; paths: string[] }
  | { status: 'error'; message: string };

/**
 * `mergeIntoIndex(tipSha, changedPaths)` — `merged` leaves `MERGE_HEAD` open; `conflicts` was
 * aborted already. `error` carries `recovery` (kind `merge-abort-failed`) only
 * when aborting a conflicted merge failed and the merge stayed open.
 */
export type GitMergeIntoIndexResult =
  | GitMergePrimitiveRefusal
  | { status: 'merged'; changedPaths: string[] }
  | { status: 'conflicts'; paths: string[] }
  | { status: 'error'; message: string; recovery?: GitErrorRecovery };

/** `abortMerge(paths)` — `error` carries the repair context `merge-abort-failed`. */
export type GitAbortMergeResult =
  | GitMergePrimitiveRefusal
  | { status: 'aborted' }
  | { status: 'error'; message: string; recovery: GitErrorRecovery };

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
 * route's preview-render check) and the client (`components/git/gitSettings.tsx`'s live
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
