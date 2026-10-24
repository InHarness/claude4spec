/**
 * 2.1.47 (M17 L2 `aae2vgem`, spec-operation `accept-shadow`) — accepting a
 * shadow: someone else's not-yet-accepted version of the specification (a ref
 * under `refs/runs/`) is merged into the master and ends as a new release, in
 * one step, on a human's command from the releases screen.
 *
 * The life cycle (`nk344dz5`):
 *   1. validation of the name and the description, before anything touches the
 *      repository (`hybasevj`);
 *   2. the release mutex (waits), then the repository lock (refuses `busy`),
 *      both held to the end of the sequence (`g4rsukyw`, M28 `ezudoqef`);
 *   3. the guards under the lock, in a fixed order (`rnwev4kg`);
 *   4. suppression of the shadow paths' events for the operation (M40) and the
 *      high-water mark of the page versions (`qi04ao7g`);
 *   5. the merge into the index of the tip SHA from the preview (M28 `es9w55mr`);
 *   6. the in-band capture of the merged paths — no rebuild of the project
 *      context (`mghvzn0w`, M31 `hp1z8pox`);
 *   7. the release, through the acceptance variant of `createRelease`
 *      (file → cache → transaction, `wh8x023p`);
 *   8. its commit under the held lock — a merge commit with two parents.
 *
 * The commit of the release transaction is the point of no return. A failure
 * after the merge and before it runs the ROLLBACK: the merge is aborted, the
 * chains of the reverted paths run, and the unreleased page versions the
 * operation wrote for the shadow's paths are deleted — the repository and the
 * version log are back to their state before the call. A rollback that cannot
 * abort leaves the merge open for repair (`ACCEPT_ABORT_FAILED`). A failed
 * merge commit after the point of no return is an ordinary git sync result
 * (`gitSync.status: 'error'`, `recovery.kind: 'merge-open'`), not a failure.
 * A failure after the transaction committed (reading the release back,
 * `AcceptedReleaseCommittedError`) rolls nothing back: the merge commit lands
 * and the failure is reported.
 *
 * `git:status-changed` goes out after the acceptance (the merge commit emits
 * `headChanged: true` itself) and after a rollback (`headChanged: false`); the
 * project context is never rebuilt — the clients reload the route.
 */

import nodeFs from 'node:fs';
import type Database from 'better-sqlite3';
import type { AcceptedShadow, ShadowAcceptRequest } from '../../shared/entities.js';
import type { GitCommitResult, GitErrorRecovery } from '../../shared/git.js';
import { readConfig } from '../config.js';
import type { WatchEventKind } from '../fs/watcher.js';
import type { SnapshotData } from '../serialization/types.js';
import type { GitHeldRepo, GitLockHandle, GitService } from './git.js';
import { acceptanceFlags, gitUnavailable, type ShadowDiffScope } from './release-shadow-diff.js';
import { DomainError } from './tags.js';

/** One entity version the shadow brings — written by the release transaction (`mghvzn0w`). */
export interface ShadowEntityVersion {
  type: string;
  slug: string;
  op: 'create' | 'update' | 'delete';
  /** The snapshot after the chain; for `delete` the state before it (the tombstone keeps the last-known data). */
  data: SnapshotData;
  /** The type's payload version at capture time. */
  serializerVersion: string | null;
}

/** The two internal options of the acceptance variant of `createRelease` — no channel takes them from a caller. */
export interface AcceptReleaseVariant {
  acceptedShadow: AcceptedShadow;
  shadowEntityVersions: ShadowEntityVersion[];
}

/**
 * What the acceptance needs from the file-watch runtime of its project (M40):
 * the operation suppression, the in-band chain of one path and the
 * `file_version` keys of a path. Wired by the project context.
 */
export interface AcceptShadowRuntime {
  /** Suppress every event of these ABSOLUTE paths until `release()` (M40 `c38qf5p5`). */
  suppressOperation(absPaths: readonly string[]): { release(): void };
  /** Run the reaction chain of one ABSOLUTE path in-band, as the agent's write; rejects when the chain failed. */
  runChain(absPath: string, event: WatchEventKind): Promise<void>;
  /** The `(rootId, relPath)` keys `file_version` files this ABSOLUTE path under — none outside the roots. */
  pageKeys(absPath: string): Array<{ rootId: string; relPath: string }>;
}

/** The entity side of the capture — the index (M29) as the chain left it. */
export interface AcceptShadowEntities {
  /** The entity an ABSOLUTE path is the file of (`<entities root>/<type>/<slug>.json`), or `null`. */
  locate(absPath: string): { type: string; slug: string } | null;
  /** The snapshot of the entity's index row, `null` when the index has none. */
  snapshot(type: string, slug: string): SnapshotData | null;
  /** Is `snapshot` the content of the entity's latest (non-delete) version already? */
  unchanged(type: string, slug: string, snapshot: SnapshotData): boolean;
  payloadVersion(type: string): string | null;
}

/** `R` — the release the acceptance variant of `createRelease` returns. */
export interface AcceptShadowDeps<R extends { name: string; description: string }> {
  db: Database.Database;
  cwd: string;
  git: Pick<
    GitService,
    | 'tryWithRepoLock'
    | 'agentTurnActive'
    | 'mergePrimitiveRoot'
    | 'resolveShadow'
    | 'pendingChanges'
    | 'shadowChangedPaths'
    | 'mergeTree'
    | 'mergeIntoIndex'
    | 'abortMerge'
    | 'commitOnRelease'
    | 'notifyStatusChanged'
  >;
  runtime: AcceptShadowRuntime;
  entities: AcceptShadowEntities;
  /** The registry roots — the pathspecs of the pending-changes test and the content flags. */
  scope: () => ShadowDiffScope;
  /** Step 1 — `createRelease`'s validation of the name and the description; returns them trimmed. */
  validate(name: string, description: string): { name: string; description: string };
  /** The release mutex of the project (waits). */
  withReleaseMutex<T>(fn: () => Promise<T>): Promise<T>;
  /** Step 7 — the acceptance variant of `createRelease`; throws when the file, the cache or the transaction fails. */
  createRelease(input: { name: string; description: string }, variant: AcceptReleaseVariant): R;
}

/**
 * Thrown by the acceptance variant of `createRelease` when a step AFTER its
 * transaction committed fails (reading the release back). The point of no
 * return is behind: the release, its file and its versions stay, and the
 * acceptance lands its merge commit instead of rolling back.
 */
export class AcceptedReleaseCommittedError extends Error {
  /**
   * The release commit's result, set once the acceptance has landed it. The
   * error answer carries it (`error.gitSync`, `routes/errors.ts`): a client
   * reads from it, as from a success, whether its own operation moved HEAD.
   */
  gitSync?: GitCommitResult | null;

  constructor(
    readonly release: { name: string; description: string },
    cause: unknown,
  ) {
    super(
      `The release '${release.name}' was created, but reading it back failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'AcceptedReleaseCommittedError';
  }
}

/** A refusal or failure of the acceptance with its code (409/500 from the code table). */
function refuse(code: string, message: string, extra?: { details?: string[]; recovery?: GitErrorRecovery }): DomainError {
  const err = new DomainError(code, message);
  if (extra?.details) Object.assign(err, { details: extra.details });
  if (extra?.recovery) Object.assign(err, { recovery: extra.recovery });
  return err;
}

const busy = (): DomainError =>
  refuse('ACCEPT_BUSY', 'A git operation or an agent turn is running — try accepting the shadow again in a moment.');

/** `VALIDATION` unless the body carries the shadow id and both preview SHAs as non-empty strings. */
export function parseShadowAcceptRequest(body: unknown): ShadowAcceptRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  for (const key of ['ref', 'expectedTipSha', 'expectedHeadSha'] as const) {
    if (typeof b[key] !== 'string' || (b[key] as string).length === 0) {
      throw new DomainError('VALIDATION', `'${key}' is required: a non-empty string from the shadow preview.`);
    }
  }
  return {
    ref: b.ref as string,
    expectedTipSha: b.expectedTipSha as string,
    expectedHeadSha: b.expectedHeadSha as string,
    name: typeof b.name === 'string' ? b.name : '',
    description: typeof b.description === 'string' ? b.description : '',
  };
}

/**
 * Accept the shadow named by `body.ref`. Resolves to the release (with
 * `gitSync`); throws the refusals and failures of the record as
 * `DomainError`s.
 */
export async function acceptShadow<R extends { name: string; description: string }>(
  deps: AcceptShadowDeps<R>,
  body: unknown,
): Promise<R & { gitSync: GitCommitResult | null }> {
  const request = parseShadowAcceptRequest(body);
  // 1. Validation — before the mutex, the lock and the repository.
  const { name, description } = deps.validate(request.name, request.description);

  // 2. The release mutex (waits), then the repository lock (refuses).
  return deps.withReleaseMutex(async () => {
    const run = await deps.git.tryWithRepoLock((lock) => sequence(deps, request, { name, description }, lock));
    if (run === null) throw busy();
    return run;
  });
}

async function sequence<R extends { name: string; description: string }>(
  deps: AcceptShadowDeps<R>,
  request: ShadowAcceptRequest,
  input: { name: string; description: string },
  lock: GitLockHandle,
): Promise<R & { gitSync: GitCommitResult | null }> {
  const { git } = deps;
  // An agent turn running at the moment of the call is a refusal, not a wait.
  if (git.agentTurnActive()) throw busy();

  // 3. The guards under the lock, in the record's fixed order.
  const gate = await git.mergePrimitiveRoot();
  if ('refusal' in gate) {
    if (gate.refusal.status === 'no-branch') {
      throw refuse('ACCEPT_NO_BRANCH', 'HEAD is not on a named branch — check out a branch before accepting a shadow.');
    }
    throw gitUnavailable();
  }
  const repo = { detected: true, rootPath: gate.root };
  // The gate was read under the held lock: root and branch cannot change until
  // the end of the sequence, so the primitives take it instead of re-reading it.
  const held: GitHeldRepo = { root: gate.root, lock };
  if (readConfig(deps.cwd).git.commitTarget.mode !== 'current') {
    throw refuse(
      'ACCEPT_TARGET_NOT_CURRENT',
      'The merge commit of an acceptance lands on the current branch only — set the release commit target to the current branch.',
    );
  }
  const shadow = await git.resolveShadow(request.ref, repo);
  if (!shadow) {
    throw new DomainError(
      'SHADOW_NOT_FOUND',
      `No shadow '${request.ref}' to accept: the ref does not exist under refs/runs/, has no common ancestor with HEAD, or is already contained in HEAD (accepted).`,
      'List the shadows with GET /api/git/shadows.',
    );
  }
  if (shadow.tipSha !== request.expectedTipSha || shadow.headSha !== request.expectedHeadSha) {
    throw refuse(
      'ACCEPT_STALE',
      'The shadow or the master moved since the preview was computed — refresh the preview and accept again.',
    );
  }
  const scope = deps.scope();
  const pending = await git.pendingChanges(
    scope.registryRoots.map((r) => r.dir),
    held,
  );
  if (pending.status === 'dirty') {
    throw refuse(
      'ACCEPT_DIRTY',
      `There are pending changes (${pending.paths.join(', ')}) — commit or discard them before accepting a shadow.`,
      { details: pending.paths },
    );
  }
  if (pending.status === 'busy') throw busy();
  if (pending.status !== 'clean') {
    throw new Error(`Accepting the shadow failed: the pending-changes test failed (${pending.status === 'error' ? pending.message : pending.status}).`);
  }
  const changedPaths = await git.shadowChangedPaths(shadow.baseSha, shadow.tipSha, repo);
  if (!changedPaths) throw new Error('Accepting the shadow failed: the files of the shadow could not be read.');
  const flags = acceptanceFlags(changedPaths, scope.registryRoots, gate.root);
  if (flags.outsideSpecFiles.length > 0) {
    throw refuse(
      'ACCEPT_OUTSIDE_SPEC',
      `The shadow changes files outside the specification roots (${flags.outsideSpecFiles.join(', ')}).`,
      { details: flags.outsideSpecFiles },
    );
  }
  if (flags.touchesReleases) {
    throw refuse('ACCEPT_RELEASES_IN_SHADOW', 'The shadow changes the releases root — a release file is never accepted from a shadow.');
  }
  const trial = await git.mergeTree(shadow.headSha, shadow.tipSha, repo);
  if (trial?.status === 'conflicts') {
    throw refuse('ACCEPT_CONFLICTS', `The shadow conflicts with the master (${trial.paths.join(', ')}).`, {
      details: trial.paths,
    });
  }
  if (!trial || trial.status === 'error') throw new Error('Accepting the shadow failed: the trial merge failed.');

  // 4. Suppression of the shadow paths' events; the high-water mark of the page versions.
  const suppression = deps.runtime.suppressOperation(changedPaths);
  try {
    const mark = (deps.db.prepare(`SELECT COALESCE(MAX(id), 0) AS id FROM file_version`).get() as { id: number }).id;
    const existedBefore = new Map(changedPaths.map((p) => [p, nodeFs.existsSync(p)]));

    // 5. The merge into the index of the PREVIEWED tip SHA.
    const merged = await git.mergeIntoIndex(request.expectedTipSha, changedPaths, held);
    if (merged.status === 'conflicts') {
      // The real merge conflicted; the primitive aborted it.
      throw refuse('ACCEPT_CONFLICTS', `The shadow conflicts with the master (${merged.paths.join(', ')}).`, {
        details: merged.paths,
      });
    }
    if (merged.status === 'error' && merged.recovery) {
      git.notifyStatusChanged(false);
      throw refuse('ACCEPT_ABORT_FAILED', `Accepting the shadow failed and its merge could not be undone: ${merged.message}`, {
        recovery: merged.recovery,
      });
    }
    if (merged.status !== 'merged') {
      throw refuse(
        'ACCEPT_FAILED',
        `Accepting the shadow failed: the merge did not run (${merged.status === 'error' ? merged.message : merged.status}).`,
      );
    }
    const paths = merged.changedPaths;

    let release: R;
    try {
      // 6. Capture of the merged paths, in-band.
      const shadowEntityVersions = await captureMerged(deps, paths, existedBefore);
      // 7. The release — acceptance variant; its transaction is the point of no return.
      release = deps.createRelease(input, {
        acceptedShadow: { id: shadow.id, tipSha: request.expectedTipSha },
        shadowEntityVersions,
      });
    } catch (err) {
      if (err instanceof AcceptedReleaseCommittedError) {
        // Past the point of no return: no rollback — the release exists, its
        // merge commit lands; the failure to read it back is reported.
        const gitSync = await git.commitOnRelease(err.release, lock);
        if (gitSync?.status !== 'committed') git.notifyStatusChanged(false);
        err.gitSync = gitSync;
        throw err;
      }
      await rollback(deps, paths, mark, held);
      throw refuse('ACCEPT_FAILED', `Accepting the shadow failed and was rolled back: ${(err as Error).message}`);
    }

    // 8. The merge commit under the held lock. A failure here is a git sync
    // result (`merge-open`), not a failure of the operation: the release exists.
    const gitSync = await git.commitOnRelease(release, lock);
    if (gitSync?.status !== 'committed') git.notifyStatusChanged(false);
    return { ...release, gitSync };
  } finally {
    // Lifted only after the rollback's clean-up, so a late watcher event cannot
    // write an empty deletion row for a page the shadow added.
    suppression.release();
  }
}

/**
 * Step 6 (`mghvzn0w`): the chain of every merged path, as the agent's write
 * (`changed_by = 'agent'`); the page versions are written by the chains'
 * capture, the entity versions are returned for the release transaction.
 */
async function captureMerged(
  deps: Pick<AcceptShadowDeps<never>, 'runtime' | 'entities'>,
  paths: readonly string[],
  existedBefore: ReadonlyMap<string, boolean>,
): Promise<ShadowEntityVersion[]> {
  const entityPaths = paths.flatMap((abs) => {
    const entity = deps.entities.locate(abs);
    return entity ? [{ abs, ...entity }] : [];
  });
  // A deleted entity's state "before" — read from the index BEFORE the chain removes its row.
  const before = new Map(entityPaths.map((e) => [e.abs, deps.entities.snapshot(e.type, e.slug)]));

  for (const abs of paths) {
    const present = nodeFs.existsSync(abs);
    const event: WatchEventKind = !present ? 'unlink' : existedBefore.get(abs) ? 'change' : 'add';
    await deps.runtime.runChain(abs, event);
  }

  const versions: ShadowEntityVersion[] = [];
  for (const e of entityPaths) {
    const prior = before.get(e.abs) ?? null;
    const serializerVersion = deps.entities.payloadVersion(e.type);
    if (!nodeFs.existsSync(e.abs)) {
      if (prior) versions.push({ type: e.type, slug: e.slug, op: 'delete', data: prior, serializerVersion });
      continue;
    }
    const after = deps.entities.snapshot(e.type, e.slug);
    if (!after) throw new Error(`the entity ${e.type}/${e.slug} is not in the index after its reaction chain`);
    if (prior && deps.entities.unchanged(e.type, e.slug, after)) continue;
    versions.push({ type: e.type, slug: e.slug, op: prior ? 'update' : 'create', data: after, serializerVersion });
  }
  return versions;
}

/**
 * The rollback (`qi04ao7g`): abort the merge, run the chains of the reverted
 * paths, then delete the unreleased page versions above the high-water mark —
 * only for the merged paths — so the last row of each path is the version from
 * before the call again. Entities need no clean-up: their rows are written
 * only by the release transaction.
 */
async function rollback(
  deps: Pick<AcceptShadowDeps<never>, 'db' | 'git' | 'runtime'>,
  paths: readonly string[],
  mark: number,
  held: GitHeldRepo,
): Promise<void> {
  const aborted = await deps.git.abortMerge([...paths], held);
  if (aborted.status !== 'aborted') {
    deps.git.notifyStatusChanged(false);
    throw refuse(
      'ACCEPT_ABORT_FAILED',
      `Accepting the shadow failed and its merge could not be undone${aborted.status === 'error' ? `: ${aborted.message}` : ''}.`,
      aborted.status === 'error' ? { recovery: aborted.recovery } : undefined,
    );
  }
  for (const abs of paths) {
    try {
      await deps.runtime.runChain(abs, nodeFs.existsSync(abs) ? 'change' : 'unlink');
    } catch (err) {
      console.warn(`[accept-shadow] rollback chain of ${abs} failed:`, (err as Error).message);
    }
  }
  const remove = deps.db.prepare(
    `DELETE FROM file_version WHERE release_id IS NULL AND id > ? AND rootId = ? AND path = ?`,
  );
  deps.db.transaction(() => {
    for (const abs of paths) {
      for (const key of deps.runtime.pageKeys(abs)) remove.run(mark, key.rootId, key.relPath);
    }
  })();
  deps.git.notifyStatusChanged(false);
}
