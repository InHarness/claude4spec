/**
 * 2.1.46 (M17 L2 `jssreefn`, spec-operation `shadow-diff`) — the shadow
 * comparison: what the master's specification becomes once a shadow (someone
 * else's not-yet-accepted version, a ref under `refs/runs/`) is accepted.
 *
 * Computed from git alone, by the two-state delta core (`0jsqpl74`), in one of
 * two modes — the trial merge decides which:
 *   - `merge` (`pu2g4dms`, the default): the trial merge of HEAD with the tip is
 *     clean; the delta is the core on `HEAD → result tree`. Master changes made
 *     after the shadow branched are in the result tree, so they do not read as a
 *     revert; uncommitted master changes stay out, because the left side is HEAD.
 *   - `shadow-only` (`ce8plh8i`): the trial merge conflicted, or cannot run on a
 *     git older than 2.38 (`mergePreview: false`); the delta is the core on
 *     `merge-base..tip` plus the conflicted paths. A conflicted tree carries
 *     conflict markers and is never rendered.
 *
 * The left side of the delta is the source of the "before" state of the deleted
 * entities (`0xvhubti`); the acceptance flags (`nemiv2qh`) are computed on
 * `merge-base..tip` in both modes. The result is not reproducible (`856sq0nw`) —
 * it carries the tip and HEAD SHAs it was computed on.
 *
 * Read-only: no repository lock, nothing touches HEAD, the index, the working
 * tree or a ref — the trial merge writes objects only. Refusals (`22u3o5bx`):
 * `VALIDATION` (no `ref`), `GIT_UNAVAILABLE` (git off or no repository — never
 * an empty delta and never the SQLite track), `SHADOW_NOT_FOUND` (no such ref,
 * no common ancestor with HEAD, or already an ancestor of HEAD).
 */

import nodePath from 'node:path';
import type { ShadowDiffResponse } from '../../shared/entities.js';
import type { RootKind } from '../../shared/root-kinds.js';
import type { GitService } from './git.js';
import {
  computeTwoStateDelta,
  type DeletedEntityPayloads,
  type DeltaDeps,
  type DeltaRoots,
} from './git-two-state-delta.js';
import { DomainError } from './tags.js';
import { isPathWithin } from '../workspace/registry.js';

/** Where the comparison looks — resolved by the release service from the root registry. */
export interface ShadowDiffScope {
  /**
   * The roots of the delta (the release-flag roots, the `releases` root excluded) — the same as the release diff's.
   * Its unfiltered `pathspecs` — the dir of every root whose kind has the `release` flag plus the
   * `releases` root — is the one set with two consumers (2.1.52): the release's git diff and the
   * strict pending-changes test of the shadow acceptance, which checks it whole.
   */
  roots: DeltaRoots;
  /**
   * EVERY registry root, with its kind and its absolute, realpath'd dir: a
   * changed path outside all of them is `outsideSpecFiles`; one inside a root of
   * kind `releases` sets `touchesReleases` — gated by the KIND (L13), never by a dir.
   */
  registryRoots: ReadonlyArray<{ kind: RootKind; dir: string }>;
}

export interface ShadowDiffDeps {
  git: Pick<GitService, 'probeRepo' | 'resolveShadow' | 'mergeTree' | 'listCommits' | 'diffRefs' | 'showFile'>;
  pageSerializer: DeltaDeps['pageSerializer'];
  host: DeltaDeps['host'];
  scope: () => ShadowDiffScope;
}

/**
 * The two content flags of the acceptance (`nemiv2qh`) over the ABSOLUTE paths
 * a shadow changes (`merge-base..tip`): `outsideSpecFiles` — the paths under
 * no registry root, repository-relative and sorted; `touchesReleases` — a path
 * inside a root of kind `releases`. Shared by the comparison and by the
 * acceptance's guards, so both read the same flags off the same paths.
 */
export function acceptanceFlags(
  absPaths: readonly string[],
  registryRoots: ShadowDiffScope['registryRoots'],
  rootPath: string,
): { outsideSpecFiles: string[]; touchesReleases: boolean } {
  const outside = new Set<string>();
  let touchesReleases = false;
  for (const abs of absPaths) {
    const owners = registryRoots.filter((root) => isPathWithin(root.dir, abs));
    if (owners.length === 0) outside.add(nodePath.relative(rootPath, abs).split(nodePath.sep).join('/'));
    else if (owners.some((root) => root.kind === 'releases')) touchesReleases = true;
  }
  return { outsideSpecFiles: [...outside].sort(), touchesReleases };
}

/** `GIT_UNAVAILABLE` (400) — also raised by the release service when no git service is wired. */
export function gitUnavailable(): DomainError {
  return new DomainError(
    'GIT_UNAVAILABLE',
    'The shadow comparison is computed from git only, and git is disabled or no repository was detected.',
    'Enable git in the project settings and make sure the specification lives in a git repository.',
  );
}

/** `VALIDATION` (400) unless `ref` is a non-empty string — checked before anything touches git. */
export function requireShadowRef(ref: unknown): asserts ref is string {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new DomainError(
      'VALIDATION',
      "Query parameter 'ref' is required: the shadow id (the ref name without the refs/runs/ prefix).",
    );
  }
}

/** A git command failed under a detected repository — a server fault, not a refusal of the request. */
function gitFailed(what: string): Error {
  return new Error(`The shadow comparison failed: ${what}.`);
}

/**
 * The shadow comparison of the shadow `ref` (its ref name without `refs/runs/`)
 * with the master. Throws the refusals above as `DomainError`s; a git failure
 * under a detected repository is a plain `Error` (500).
 */
export async function computeShadowDiff(deps: ShadowDiffDeps, ref: unknown): Promise<ShadowDiffResponse> {
  requireShadowRef(ref);

  // ONE repository probe, handed to every primitive below (and to the core).
  const repo = await deps.git.probeRepo();
  if (!repo?.rootPath) throw gitUnavailable();
  const rootPath = repo.rootPath;

  const shadow = await deps.git.resolveShadow(ref, repo);
  if (!shadow) {
    throw new DomainError(
      'SHADOW_NOT_FOUND',
      `No shadow '${ref}' to compare: the ref does not exist under refs/runs/, has no common ancestor with HEAD, or is already contained in HEAD (accepted).`,
      'List the shadows with GET /api/git/shadows.',
    );
  }
  const { tipSha, baseSha, headSha, masterAhead } = shadow;

  const merged = await deps.git.mergeTree(headSha, tipSha, repo);
  if (!merged) throw gitUnavailable();
  // ASSUMPTION:dev-4601 — the model names two causes of `shadow-only` (a conflict,
  // git < 2.38); a trial merge that FAILS on a supported git is neither, so it is a
  // server fault (500), not a silent fall to `shadow-only`.
  if (merged.status === 'error') throw gitFailed('the trial merge (git merge-tree) failed');

  const mode: ShadowDiffResponse['mode'] = merged.status === 'clean' ? 'merge' : 'shadow-only';
  const [left, right] = merged.status === 'clean' ? [headSha, merged.tree] : [baseSha, tipSha];
  const scope = deps.scope();
  const before: DeletedEntityPayloads = {};

  const [delta, shadowFiles, commits] = await Promise.all([
    computeTwoStateDelta(deps, left, right, scope.roots, { repo, deletedBefore: before }),
    // The flags read the shadow's own change, `merge-base..tip`, over the whole repository.
    deps.git.diffRefs(baseSha, tipSha, [rootPath], repo),
    deps.git.listCommits(baseSha, tipSha, repo),
  ]);
  if (!delta) throw gitFailed('the file list of the delta could not be read');
  if (!shadowFiles) throw gitFailed('the files of the shadow could not be read');
  if (!commits) throw gitFailed('the commits of the shadow could not be read');

  const { outsideSpecFiles, touchesReleases } = acceptanceFlags(
    shadowFiles.files.map((f) => f.path),
    scope.registryRoots,
    rootPath,
  );

  return {
    mode,
    shadow: { id: shadow.id, tipSha },
    head: { sha: headSha },
    base: { sha: baseSha },
    masterAhead,
    conflicts: merged.status === 'conflicts' ? merged.paths : [],
    mergePreview: merged.status !== 'unsupported',
    outsideSpecFiles,
    touchesReleases,
    commits,
    entities: delta.entities,
    pages: delta.pages,
    before: before as ShadowDiffResponse['before'],
  };
}
