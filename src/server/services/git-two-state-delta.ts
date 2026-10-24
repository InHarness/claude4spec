/**
 * 2.1.46 (M17 L2 `0jsqpl74`) — the two-state delta: the shared core of the git
 * track.
 *
 * It computes the structural delta of entities and pages between two states of
 * the repository — each a commit or a tree — over the pathspecs of the release
 * roots. Every use of the git track goes through it: the release diff
 * (`ReleaseService.getReleaseDiff`, on the two reign snapshots) and the shadow
 * comparison (M17 shadow diff). Which two states to compare, which side is which
 * and what they mean to the user is the CALLER's knowledge alone: this module
 * knows nothing of releases or SQLite and takes neither a release row nor a
 * database.
 *
 * Input (`22vm79i8`): two states plus the root pathspecs. The list of files that
 * differ between the states and a file's content in a state are read through the
 * M28 primitives (`GitService.diffRefs` / `GitService.showFile`, M28 `eu1rffp6`);
 * the core never reads the working tree or the index.
 *
 * Classification (`87eua06x`): a differing file enters the delta by the root it
 * belongs to — a release-flag `pages` root → the M02 page diff on the file's
 * content on both sides; the `entities` root → the host entity diff on both
 * sides' payloads; the `releases` root → not delta content. A file that differs
 * only in system fields yields no entry (M13 `m68m7s0o`).
 *
 * Result (`x2dmbhhk`): the entity and page lists, in the shape of the `entities`
 * and `pages` fields of `RawDelta`.
 *
 * The classification and the two per-file diffs are exported on their own as
 * well: the unreleased-diff track (`:to = current`) compares a state with the
 * working tree — which is not a state, so it is not this core — and reuses them
 * with a working-tree reader on its new side.
 */

import nodePath from 'node:path';
import type { RawDeltaEntityChange } from '../../shared/entities.js';
import type { GitRefDiff } from '../../shared/git.js';
import { hasDotSegment } from '../../shared/page-files.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import { readPayloadVersion, stripFileEnvelope, upgradeCapture } from '../serialization/payload-upgrade.js';
import { toRawDeltaEntityChange } from '../serialization/snapshot.js';
import type { SnapshotData } from '../serialization/types.js';
import type { FileDiff, FileSerializer } from './file-serializer.js';
import { mapBounded, type GitRepoRoot, type GitService } from './git.js';

/** A commit-ish or a tree SHA — anything `git diff <a> <b>` and `git show <state>:<path>` accept. */
export type RepoState = string;

/**
 * At most this many changed files are read (each read = up to two `git show`
 * subprocesses) at once. A release diff can touch hundreds of files — the boot
 * backfill commit alone marks every entity file modified — and an unbounded
 * fan-out would put one process per file in flight on a single request.
 */
export const DELTA_READ_CONCURRENCY = 8;

/** `diffRefs` flattens renames (R) into a D(old) + A(new) pair; `R` stays mapped for safety. */
const STATUS_TO_PAGE_OP: Record<'A' | 'M' | 'D' | 'R', 'created' | 'modified' | 'deleted'> = {
  A: 'created',
  M: 'modified',
  D: 'deleted',
  R: 'created',
};

/** The same statuses in the ENTITY vocabulary (`EntityDiff`'s `updated`, not M02's `modified`). */
const STATUS_TO_ENTITY_OP: Record<'A' | 'M' | 'D' | 'R', 'created' | 'updated' | 'deleted'> = {
  A: 'created',
  M: 'updated',
  D: 'deleted',
  R: 'created',
};

type FileStatus = GitRefDiff['files'][number]['status'];

/**
 * The roots the delta is computed over, resolved by the caller. All dirs are
 * absolute and realpath'd: the M28 primitives answer with paths under the
 * symlink-resolved repo top level.
 */
export interface DeltaRoots {
  /** Everything handed to `diffRefs` after `--`. */
  pathspecs: string[];
  /** The release-flag `pages` roots in scope, `rootId → dir`, in attribution order. */
  pageRoots: ReadonlyMap<string, string>;
  /** The `entities` root: its dir, and the parser that tells an entity file from any other path under it. */
  entities: { dir: string; parseRelPath(relPath: string): { type: string; slug: string } | null };
  /** Dirs whose files are never delta content: the `releases` root (and the briefs/patches system roots). */
  excluded: readonly string[];
  /** Narrowing to exact pages (`paths` filter): a pathspec is a prefix match for git. Absent = every page. */
  acceptsPage?: (rootId: string, relPath: string) => boolean;
}

export interface DeltaDeps {
  git: Pick<GitService, 'probeRepo' | 'diffRefs' | 'showFile'>;
  pageSerializer: Pick<FileSerializer, 'snapshotFromContent' | 'diff'>;
  host: Pick<PluginHost, 'diff' | 'getEntity'>;
}

/** The two lists of `RawDelta` — no `from`/`to`: what the sides are is the caller's to say. */
export interface TwoStateDelta {
  entities: RawDeltaEntityChange[];
  pages: FileDiff[];
}

/**
 * The "before" state of the entities a delta deletes, read off its LEFT side —
 * `type → slug → payload` (envelope stripped, brought to the type's current
 * shape, exactly what the entity diff compared). A commit has no SQLite snapshot,
 * so a caller comparing commits gets a deleted entity's last content here.
 */
export type DeletedEntityPayloads = Record<string, Record<string, SnapshotData>>;

export interface TwoStateDeltaOptions {
  /** An already-taken `probeRepo()` — the core then probes nothing itself. */
  repo?: GitRepoRoot;
  /**
   * Collect the left-side payload of every deleted entity into this map while the
   * entity diff reads it — the same `git show`, no second read.
   */
  deletedBefore?: DeletedEntityPayloads;
}

export interface EntityCandidate {
  type: string;
  slug: string;
  absPath: string;
  status: FileStatus;
}

export interface PageCandidate {
  rootId: string;
  relPath: string;
  absPath: string;
  status: FileStatus;
}

/** Reads one side of a changed file; `null` = absent in that state, or unreadable. */
export type SideReader = (absPath: string) => Promise<string | null>;

function isInside(parent: string, child: string): boolean {
  const rel = nodePath.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !nodePath.isAbsolute(rel);
}

/** Splits the changed files by root (`87eua06x`); files of the excluded roots and of no root in scope fall out. */
export function classifyChangedFiles(
  files: GitRefDiff['files'],
  roots: DeltaRoots,
): { entities: EntityCandidate[]; pages: PageCandidate[] } {
  const entities: EntityCandidate[] = [];
  const pages: PageCandidate[] = [];

  for (const file of files) {
    if (roots.excluded.some((dir) => isInside(dir, file.path))) continue;

    if (isInside(roots.entities.dir, file.path)) {
      const relPath = nodePath.relative(roots.entities.dir, file.path).replaceAll(nodePath.sep, '/');
      const parsed = roots.entities.parseRelPath(relPath);
      if (parsed) entities.push({ type: parsed.type, slug: parsed.slug, absPath: file.path, status: file.status });
      continue;
    }

    for (const [rootId, dir] of roots.pageRoots) {
      if (!isInside(dir, file.path)) continue;
      const relPath = nodePath.relative(dir, file.path).replaceAll(nodePath.sep, '/');
      // Any non-page file under a dot-dir (`.claude4spec/config.json`, …) — the
      // page walker's convention. `continue`, not `break`: a MORE specific root
      // (e.g. one at `.docs`) may legitimately own that subtree.
      if (hasDotSegment(relPath)) continue;
      if (roots.acceptsPage && !roots.acceptsPage(rootId, relPath)) break;
      pages.push({ rootId, relPath, absPath: file.path, status: file.status });
      break;
    }
  }
  return { entities, pages };
}

/**
 * The M02 page diff of each changed page on both sides' content.
 *
 * `op` follows git's status, never content presence: a side that should exist
 * but reads back `null`, or content that fails to parse (malformed historical
 * frontmatter), degrades that one page to file-level detail rather than
 * relabelling a modification as a creation or failing the whole delta.
 */
export async function diffChangedPages(
  candidates: readonly PageCandidate[],
  readOld: SideReader,
  readNew: SideReader,
  pageSerializer: DeltaDeps['pageSerializer'],
  logLabel: string,
): Promise<FileDiff[]> {
  const degraded = (c: PageCandidate, op: FileDiff['op']): FileDiff => ({
    rootId: c.rootId,
    path: c.relPath,
    op,
    added_sections: [],
    removed_sections: [],
    modified_sections: [],
    moved_sections: [],
    frontmatter_diff: null,
    xml_refs_diff: null,
  });

  const diffs = await mapBounded(candidates, DELTA_READ_CONCURRENCY, async (c): Promise<FileDiff | null> => {
    const op = STATUS_TO_PAGE_OP[c.status];
    const wantOld = op !== 'created';
    const wantNew = op !== 'deleted';
    try {
      const [oldContent, newContent] = await Promise.all([
        wantOld ? readOld(c.absPath) : Promise.resolve(null),
        wantNew ? readNew(c.absPath) : Promise.resolve(null),
      ]);
      if ((wantOld && oldContent == null) || (wantNew && newContent == null)) {
        console.error(
          `[release] ${logLabel}: could not read content for page '${c.relPath}' (status ${c.status}) — degrading to file-level status only`,
        );
        return degraded(c, op);
      }
      const a = oldContent != null ? pageSerializer.snapshotFromContent(c.relPath, oldContent) : null;
      const b = newContent != null ? pageSerializer.snapshotFromContent(c.relPath, newContent) : null;
      const diff = pageSerializer.diff(a, b, c.relPath, c.rootId);
      return diff.op === 'noop' ? null : diff;
    } catch (err) {
      console.error(
        `[release] ${logLabel}: failed to diff page '${c.relPath}' — degrading to file-level status only:`,
        err instanceof Error ? err.message : String(err),
      );
      return degraded(c, op);
    }
  });
  return diffs.filter((d): d is FileDiff => d !== null);
}

/**
 * The host entity diff of each changed entity on both sides' payloads.
 *
 * Each side's file is parsed, stripped of its envelope (`createdAt`/`updatedAt`
 * and the `payloadVersion` marker — system fields, not content) and brought to
 * the type's current shape, exactly as the SQLite track does with a capture; the
 * host then diffs the two payloads. A change in system fields alone is therefore
 * a `noop` and yields no entry. A side that should exist but cannot be read or
 * parsed keeps the change, file-level (`changes: []`): reporting a change that
 * turns out cosmetic is the safe direction, hiding one is not.
 */
export async function diffChangedEntities(
  candidates: readonly EntityCandidate[],
  readOld: SideReader,
  readNew: SideReader,
  host: DeltaDeps['host'],
  deletedBefore?: DeletedEntityPayloads,
): Promise<RawDeltaEntityChange[]> {
  const payloadOf = (type: string, text: string): { data: SnapshotData; version: number } => {
    const raw = JSON.parse(text) as unknown;
    const version = readPayloadVersion(raw);
    const upgraded = upgradeCapture(host.getEntity(type), stripFileEnvelope(raw) as SnapshotData, version);
    for (const warning of upgraded.warnings) console.warn(`[release] ${type}: ${warning}`);
    return { data: upgraded.data, version };
  };

  const changes = await mapBounded(candidates, DELTA_READ_CONCURRENCY, async (c): Promise<RawDeltaEntityChange | null> => {
    const fileLevel: RawDeltaEntityChange = { type: c.type, slug: c.slug, op: STATUS_TO_ENTITY_OP[c.status], changes: [] };
    const wantOld = c.status !== 'A' && c.status !== 'R';
    const wantNew = c.status !== 'D';
    const [oldText, newText] = await Promise.all([
      wantOld ? readOld(c.absPath) : Promise.resolve(null),
      wantNew ? readNew(c.absPath) : Promise.resolve(null),
    ]);
    if ((wantOld && oldText === null) || (wantNew && newText === null)) return fileLevel;
    try {
      const a = oldText !== null ? payloadOf(c.type, oldText) : null;
      const b = newText !== null ? payloadOf(c.type, newText) : null;
      const diff = host.diff(c.type, a?.data ?? null, b?.data ?? null);
      if (diff.op === 'noop') return null;
      if (deletedBefore && diff.op === 'deleted' && a) (deletedBefore[c.type] ??= {})[c.slug] = a.data;
      const mismatch =
        a && b && a.version !== b.version ? { type: c.type, from: String(a.version), to: String(b.version) } : null;
      return toRawDeltaEntityChange(c.type, c.slug, diff, mismatch);
    } catch {
      return fileLevel; // unparseable on either side — report it rather than hide it
    }
  });
  return changes.filter((c): c is RawDeltaEntityChange => c !== null);
}

/**
 * The two-state delta between `stateA` (the left side) and `stateB` (the right
 * side) over `roots`. `null` when the M28 file list is unavailable (git off, no
 * repository, a failed `git diff`) — the caller decides what that means.
 * `opts.repo` hands in a probe the caller already took; `opts.deletedBefore`
 * collects the left-side payloads of the deleted entities (`DeletedEntityPayloads`).
 */
export async function computeTwoStateDelta(
  deps: DeltaDeps,
  stateA: RepoState,
  stateB: RepoState,
  roots: DeltaRoots,
  opts: TwoStateDeltaOptions = {},
): Promise<TwoStateDelta | null> {
  // ONE repository probe (a single `rev-parse`, nothing when git is off) shared
  // by the file list and every `showFile` below — each would otherwise run its
  // own full `detect()`, several git subprocesses and a working-tree scan.
  const repo = opts.repo ?? (await deps.git.probeRepo());
  if (!repo) return null;
  const changed = await deps.git.diffRefs(stateA, stateB, roots.pathspecs, repo);
  if (!changed) return null;

  const { entities, pages } = classifyChangedFiles(changed.files, roots);
  const readA: SideReader = (absPath) => deps.git.showFile(stateA, absPath, repo);
  const readB: SideReader = (absPath) => deps.git.showFile(stateB, absPath, repo);
  // One after the other, not side by side: each is bounded on its own, and in
  // parallel the two bounds would add up.
  const entityChanges = await diffChangedEntities(entities, readA, readB, deps.host, opts.deletedBefore);
  const pageChanges = await diffChangedPages(pages, readA, readB, deps.pageSerializer, 'two-state delta');
  return { entities: entityChanges, pages: pageChanges };
}
