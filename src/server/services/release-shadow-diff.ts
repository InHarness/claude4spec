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
import type { GitRepoRoot, GitService } from './git.js';
import {
  computeTwoStateDelta,
  type DeletedEntityPayloads,
  type DeltaDeps,
  type DeltaRoots,
} from './git-two-state-delta.js';
import { DomainError } from './tags.js';
import { isPathWithin } from '../workspace/registry.js';
import { homeRunsDir } from '../workspace/home-workspace.js';
import { RUN_RECORD_FILE } from '../runs/run-read.js';

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
  /**
   * 2.1.64 (`nemiv2qh`): the home directory of the project's workspace, `null`
   * when the workspace has none — the precondition of the exemption of the own
   * Run's record directory (`ownRunRecordDir`).
   */
  workspaceHome: string | null;
}

/**
 * 2.1.64 (M17 L2 `nemiv2qh`, `rnwev4kg`): the exemption of the record directory
 * of the shadow's OWN Run. A shadow whose id has the form `<runId>/work`, in a
 * workspace with a home directory, may change `<home>/.claude4spec/runs/<runId>/`
 * (both record files) without those paths counting as `outsideSpecFiles`. The
 * home's place in the repository is computed by M28 (`workspaceHomePath`,
 * `tmrix8ji`); a home outside the repository has no path a shadow could change.
 * Returns the ABSOLUTE exempted directory under `rootPath`, or `null` when the
 * exemption does not apply. The record directory of another `runId` and the
 * roots of another project of the workspace are never exempted.
 */
export async function ownRunRecordDir(
  git: Pick<GitService, 'workspaceHomePath'>,
  shadowId: string,
  workspaceHome: string | null,
  rootPath: string,
): Promise<string | null> {
  const match = /^([^/]+)\/work$/.exec(shadowId);
  if (!match || workspaceHome === null) return null;
  const runId = match[1]!;
  if (runId === '.' || runId === '..') return null;
  const homeRel = await git.workspaceHomePath(workspaceHome);
  if (homeRel === null) return null;
  return nodePath.join(homeRunsDir(nodePath.join(rootPath, homeRel)), runId);
}

/**
 * A runId usable as one directory name under `runs/` — never a path. Deliberately
 * NOT `RUN_ID_PATTERN` (M55 `run-id.ts`): that is the rule for a runId this master
 * mints and sends, while this guard reads a `parentRunId` from a record written by
 * the runner and only has to keep it a single path segment (see decisions.md,
 * u3 rev-0001).
 */
const isRecordDirName = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id !== '.' && id !== '..' && !/[/\\\0]/.test(id);

/** `parentRunId` of the Run record `text`, or `null` when the record has no readable one. */
function parentRunIdOf(text: string | null): string | null {
  if (text === null) return null;
  try {
    const record = JSON.parse(text) as { parentRunId?: unknown } | null;
    const parent = record && typeof record === 'object' ? record.parentRunId : undefined;
    return isRecordDirName(parent) ? parent : null;
  } catch {
    return null;
  }
}

/**
 * 2.1.68 (M17 L2 `nemiv2qh`, `rnwev4kg`): the record directories a shadow may
 * change without them counting as `outsideSpecFiles` — the own Run's
 * (`ownRunRecordDir`) and, for the shadow of a CONTINUATION Run, its
 * ancestors'. The chain of ancestors is read in the shadow's tip: the
 * `parentRunId` of the own Run's record, then the `parentRunId` of each
 * ancestor's record, in the same tip (`c4s-runner` dto `run-record`); it ends
 * at a record without a readable `parentRunId` (or at a cycle). An ancestor's
 * directory is exempted only when it is IDENTICAL in the shadow's tip and in
 * the ancestor's tip — the newest commit of the shadow's history whose
 * subject is `run <ancestor runId>: <outcome>` (`c4s-runner`
 * `modules/M07-run-execution.md` #6srvj765), so the rule holds after the
 * ancestor's ref is gone. An ancestor's directory changed after its tip, one
 * whose tip is not in the history, a Run outside the chain and a record
 * without a readable `parentRunId` stay in `outsideSpecFiles`. ABSOLUTE
 * directories, the own one first; `[]` when the own exemption does not apply
 * (no `<runId>/work` id, no home, home outside the repository).
 *
 * ASSUMPTION:dev-0004 — with several `run <runId>: …` commits in the history
 * the NEWEST is the ancestor's tip; a `parentRunId` already visited ends the
 * chain.
 */
export async function exemptRecordDirs(
  git: Pick<GitService, 'workspaceHomePath' | 'showFile' | 'commitBySubjectPrefix' | 'treeEntrySha'>,
  shadow: { id: string; tipSha: string },
  workspaceHome: string | null,
  repo: GitRepoRoot & { rootPath: string },
): Promise<string[]> {
  const own = await ownRunRecordDir(git, shadow.id, workspaceHome, repo.rootPath);
  if (own === null) return [];
  const runsDir = nodePath.dirname(own);
  const dirs = [own];
  const seen = new Set([nodePath.basename(own)]);
  let current = nodePath.basename(own);
  for (;;) {
    const parent = parentRunIdOf(await git.showFile(shadow.tipSha, nodePath.join(runsDir, current, RUN_RECORD_FILE), repo));
    if (parent === null || seen.has(parent)) break;
    seen.add(parent);
    const dir = nodePath.join(runsDir, parent);
    const parentTip = await git.commitBySubjectPrefix(shadow.tipSha, `run ${parent}: `, repo);
    if (parentTip !== null) {
      const [inShadow, inParent] = await Promise.all([
        git.treeEntrySha(shadow.tipSha, dir, repo),
        git.treeEntrySha(parentTip, dir, repo),
      ]);
      if (inShadow !== null && inShadow === inParent) dirs.push(dir);
    }
    current = parent;
  }
  return dirs;
}

export interface ShadowDiffDeps {
  git: Pick<
    GitService,
    | 'probeRepo'
    | 'resolveShadow'
    | 'mergeTree'
    | 'listCommits'
    | 'diffRefs'
    | 'showFile'
    | 'workspaceHomePath'
    | 'commitBySubjectPrefix'
    | 'treeEntrySha'
  >;
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
 * `exemptDirs` (2.1.64 `ownRunRecordDir`; 2.1.68 `exemptRecordDirs`) — the
 * own Run's record directory and those of its continuation ancestors: a path
 * inside one of them is not `outsideSpecFiles`.
 */
export function acceptanceFlags(
  absPaths: readonly string[],
  registryRoots: ShadowDiffScope['registryRoots'],
  rootPath: string,
  exemptDirs: readonly string[] = [],
): { outsideSpecFiles: string[]; touchesReleases: boolean } {
  const outside = new Set<string>();
  let touchesReleases = false;
  for (const abs of absPaths) {
    if (exemptDirs.some((dir) => isPathWithin(dir, abs))) continue;
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

  // 2.1.68: with the supersession (M28 `dadc3w49`) — a superseded shadow is
  // compared like any other, and the answer carries its `supersededBy`.
  const shadow = await deps.git.resolveShadow(ref, repo, { supersession: true });
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

  const exemptDirs = await exemptRecordDirs(deps.git, shadow, scope.workspaceHome, { detected: true, rootPath });
  const { outsideSpecFiles, touchesReleases } = acceptanceFlags(
    shadowFiles.files.map((f) => f.path),
    scope.registryRoots,
    rootPath,
    exemptDirs,
  );

  return {
    mode,
    shadow: { id: shadow.id, tipSha },
    ...(shadow.supersededBy ? { supersededBy: shadow.supersededBy } : {}),
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
