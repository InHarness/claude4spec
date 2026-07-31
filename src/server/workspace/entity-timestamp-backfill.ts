/**
 * 0.2.4 — give every pre-existing entity file a `createdAt`/`updatedAt`.
 *
 * The rest of Tier B assumes the file carries the timestamps. Every project
 * created before 0.2.4 has files that do not, and for those the host would
 * mint a fresh "now" on the next rebuild — turning a project's entire history
 * into one flat timestamp and, worse, doing it differently on every machine
 * that checks the repo out.
 *
 * So this runs ONCE, at boot, BEFORE the rebuild, and writes the FILES. The
 * normal `indexAll()` that follows projects them into the columns, which is
 * why there is no SQL migration here: the files are the source, and backfilling
 * the source is the whole job.
 *
 * It is idempotent by construction rather than by a marker table — a file that
 * already has both fields is not a candidate, so a second run finds nothing and
 * returns before spawning anything.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { EntityStore } from '../services/entity-store.js';
import { readSystemFields, toIsoMs } from '../serialization/system-fields.js';
import type { SnapshotData } from '../serialization/types.js';
import type Database from 'better-sqlite3';

/**
 * A byte that cannot occur in a git author-date or a path, marking the commit
 * lines in the interleaved `--format` + `--name-status` stream.
 */
const COMMIT_MARK = '\u0001';

/** Which rung of the ladder produced a value — logged as a tally. */
type Rung = 'entity_version' | 'git' | 'mtime' | 'placeholder';

export interface BackfillReport {
  scanned: number;
  written: number;
  byRung: Record<Rung, number>;
}

/**
 * The last-resort constant, captured ONCE per run so every entity that falls
 * this far shares one value. That is deliberate: with all placeholders equal,
 * the `slug` tiebreaker in the unified list order does the ordering, which is
 * both stable and honest — "we do not know when these were created" is better
 * expressed as "no order information" than as a fabricated sequence.
 */
function placeholderStamp(): string {
  return new Date(0).toISOString();
}

/** Absolute path of the git work tree containing `cwd`, or null when there is none. */
function repoRoot(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * First and last commit date per entity file, from ONE `git log` pass.
 *
 * Per-file `git log` would be two spawns per entity — on a spec repo with a few
 * hundred entities that is minutes of boot time. One pass over the entities
 * directory, walked newest-first, gives `last` on first sight of a path and
 * `first` on the final sight, which is all we need.
 *
 * Keys are REPO-ROOT-relative, because that is what git prints. `git log
 * --name-status` reports paths relative to the work-tree top level no matter
 * what `cwd` or pathspec it was given, so a project living in a subdirectory of
 * its repo (`<repo>/packages/spec/`) emits `packages/spec/.claude4spec/…` while
 * a cwd-relative key would say `.claude4spec/…`. Those never match, and the
 * failure is SILENT: every entity simply falls through to the `mtime` rung,
 * which on a fresh clone is the checkout time — so every file in the project
 * gets the same fabricated timestamp, gets committed, and the next clone
 * fabricates a different one. That is the exact outcome this module exists to
 * prevent, so the key is derived from the repo root the same way git derives it.
 */
function gitDatesByPath(cwd: string, entitiesDir: string): Map<string, { first: string; last: string }> {
  const out = new Map<string, { first: string; last: string }>();
  let stdout: string;
  try {
    stdout = execFileSync(
      'git',
      /**
       * `%cI` — the COMMIT date, not `%aI` (author date). `git log` walks in
       * commit-date order by default, and the newest-first logic below depends
       * on the emitted date agreeing with that traversal. They diverge whenever
       * history is rewritten: a squash-merge carries the branch's first author
       * date but the merge's commit date, so PRs that land out of authoring
       * order yield `first > last` — and the clamp at the end of the backfill
       * then collapses both timestamps onto the wrong one.
       */
      ['log', `--format=${COMMIT_MARK}%cI`, '--name-status', '--diff-filter=AMR', '--', entitiesDir],
      { cwd, encoding: 'utf-8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    // Not a git repo, git absent, timeout, output over the buffer — all mean the
    // same thing here: this rung has no answer, drop to the next one.
    return out;
  }

  let commitDate: string | null = null;
  for (const line of stdout.split('\n')) {
    if (line.startsWith(COMMIT_MARK)) {
      commitDate = toIsoMs(line.slice(COMMIT_MARK.length).trim());
      continue;
    }
    if (!commitDate || !line.trim()) continue;
    // `A\tpath`, `M\tpath`, or `R100\told\tnew` — the entity is the LAST field.
    const fields = line.split('\t');
    const file = fields[fields.length - 1]?.trim();
    if (!file) continue;
    const existing = out.get(file);
    // Newest-first: first sight is `last`, and `first` keeps being overwritten
    // until the oldest commit touching the path has been seen.
    if (existing) existing.first = commitDate;
    else out.set(file, { first: commitDate, last: commitDate });
  }
  return out;
}

/**
 * Backfill `createdAt`/`updatedAt` into every entity file missing either.
 *
 * Ladder, per entity, BOTH-OR-NOTHING — a file never ends up with one field
 * from `entity_version` and the other from `mtime`, because a mixed pair can
 * imply an ordering neither source supports:
 *   1. `entity_version` MIN/MAX — the project's own history, the best answer
 *      available, and the only one that survives a fresh clone faithfully.
 *   2. one `git log` pass — first and last commit touching the file.
 *   3. filesystem `mtime` for both — no creation date on POSIX worth trusting.
 *   4. a single shared placeholder.
 *
 * Then clamps `createdAt = min(createdAt, updatedAt)`: rung 3 can produce a
 * pair where they are equal but rungs 1 and 2 cannot guarantee ordering across
 * a rebased or grafted history, and "created after it was updated" is a value
 * every consumer would have to defend against.
 */
export function backfillEntityTimestamps(
  db: Database.Database,
  store: EntityStore,
  cwd: string,
  entitiesDir: string,
): BackfillReport {
  const report: BackfillReport = {
    scanned: 0,
    written: 0,
    byRung: { entity_version: 0, git: 0, mtime: 0, placeholder: 0 },
  };

  /**
   * Candidates first — a project already on 0.2.4 must not spawn `git`.
   *
   * A candidate must be STAMPABLE, not merely unstamped. A snapshot that is not
   * a plain object cannot carry the flat envelope at all (`attachSystemFields`
   * documents that it passes arrays and scalars through untouched), so such a
   * file would be re-detected as unstamped on every single boot — and because
   * the early return below is what keeps this cheap, one such file would
   * re-spawn the full `git log` pass over the entities directory forever. It is
   * not a candidate; it is a type whose snapshot shape has no room for the
   * envelope, which is a different fact and not this module's to fix.
   */
  const candidates: Array<{ type: string; slug: string; relPath: string; data: Record<string, unknown> }> = [];
  let unstampable = 0;
  for (const file of store.listAll()) {
    report.scanned += 1;
    let data: SnapshotData;
    try {
      data = store.readRel(file.relPath);
    } catch {
      continue; // unreadable/invalid JSON — the indexer reports it, not us
    }
    if (readSystemFields(data)) continue;
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      unstampable += 1;
      continue;
    }
    candidates.push({ ...file, data: data as Record<string, unknown> });
  }
  if (unstampable) {
    console.warn(
      `[timestamp-backfill] ${unstampable} entity file(s) have a non-object snapshot and cannot ` +
        `carry createdAt/updatedAt — they will order by slug alone`,
    );
  }
  if (!candidates.length) return report;

  const versionDates = db
    .prepare(
      `SELECT entity_type, entity_slug, MIN(created_at) AS first, MAX(created_at) AS last
         FROM entity_version
        GROUP BY entity_type, entity_slug`,
    )
    .all() as Array<{ entity_type: string; entity_slug: string; first: unknown; last: unknown }>;
  const byEntity = new Map(
    versionDates.map((r) => [`${r.entity_type}/${r.entity_slug}`, { first: r.first, last: r.last }]),
  );

  const gitDates = gitDatesByPath(cwd, entitiesDir);
  const placeholder = placeholderStamp();
  let failedWrites = 0;
  const storeRoot = path.resolve(cwd, entitiesDir);
  // git prints repo-root-relative paths; build the lookup key the same way.
  // Falls back to `cwd` when there is no work tree, which is harmless — the
  // git map is empty in that case anyway.
  const root = repoRoot(cwd) ?? cwd;
  const gitKeyFor = (relPath: string): string =>
    path.relative(root, path.join(storeRoot, relPath)).replaceAll(path.sep, '/');

  for (const candidate of candidates) {
    let rung: Rung = 'placeholder';
    let createdAt = placeholder;
    let updatedAt = placeholder;

    const version = byEntity.get(`${candidate.type}/${candidate.slug}`);
    const versionFirst = toIsoMs(version?.first);
    const versionLast = toIsoMs(version?.last);
    const gitEntry = gitDates.get(gitKeyFor(candidate.relPath));

    if (versionFirst && versionLast) {
      rung = 'entity_version';
      createdAt = versionFirst;
      updatedAt = versionLast;
    } else if (gitEntry) {
      rung = 'git';
      createdAt = gitEntry.first;
      updatedAt = gitEntry.last;
    } else {
      const mtime = statMtime(path.join(storeRoot, candidate.relPath));
      if (mtime) {
        rung = 'mtime';
        createdAt = mtime;
        updatedAt = mtime;
      }
    }

    if (createdAt > updatedAt) createdAt = updatedAt;

    try {
      store.write(
        candidate.type as never,
        candidate.slug,
        { ...candidate.data, createdAt, updatedAt } as SnapshotData,
      );
    } catch {
      // Non-kebab slug, unwritable path. Never fail boot over it — but this
      // file stays unstamped, so say so once rather than silently retrying the
      // whole pass on every future boot.
      failedWrites += 1;
      continue;
    }
    report.byRung[rung] += 1;
    report.written += 1;
  }

  console.log(
    `[timestamp-backfill] wrote ${report.written}/${report.scanned} entity files ` +
      `(entity_version: ${report.byRung.entity_version}, git: ${report.byRung.git}, ` +
      `mtime: ${report.byRung.mtime}, placeholder: ${report.byRung.placeholder})`,
  );
  if (failedWrites) {
    console.warn(
      `[timestamp-backfill] ${failedWrites} entity file(s) could not be written and remain ` +
        `unstamped — this pass will run again on the next boot until they are fixed or removed`,
    );
  }
  if (!report.byRung.git && gitDates.size === 0 && report.written) {
    // Loud because it is the difference between real history and fabricated
    // history, and because the previous shape of this code failed here silently.
    console.warn(
      `[timestamp-backfill] no git history was available for the entities directory — ` +
        `timestamps fell back to file mtime or a placeholder`,
    );
  }
  return report;
}

function statMtime(abs: string): string | null {
  try {
    return fs.statSync(abs).mtime.toISOString();
  } catch {
    return null;
  }
}
