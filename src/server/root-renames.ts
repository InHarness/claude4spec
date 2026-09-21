import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite, configPath, parseRootsArray } from './config.js';
import type { Root } from '../shared/types.js';

/**
 * 0.2.101 — the root-rename transition registry (M01).
 *
 * A page space's `id` is now the project author's choice and can be changed by
 * one explicit operation (`POST /api/config/roots/:rootId/rename`). The identity
 * it leaves behind must stay permanently taken: `file_version` rows written
 * before the rename keep the OLD `rootId` (nothing re-stamps them — that would
 * erase which address a version was actually born under), so if the retired id
 * could later be handed to a different space, the same value in two rows would
 * mean two different spaces and the history would stop being decidable.
 *
 * ## Why a sidecar file and not `config.json`
 *
 * The specification is explicit that the registry is NOT a `config.json` field —
 * the config sheet gains no row for it and `$schemaVersion` does not bump again.
 * Its shape and location are left to the implementation, with one hard
 * requirement: inside a release bundle the transitions travel ONLY as
 * `manifest.roots[].formerIds`, never through the sanitized `config.json`.
 *
 * So: `.claude4spec/root-renames.json`, written with the same atomic
 * temp→rename primitive as the config, and read by the same pure-disk-read
 * discipline (no database, so `readConfig`-shaped call sites can consult it).
 *
 * ## Crash safety
 *
 * A rename commits two files (the config and this registry), which no
 * single-file atomic write can cover. A journal written BEFORE either of them
 * names the intent; `recoverPendingRootRename` replays it on the next project
 * activation and either finishes the operation or rolls it fully back. The
 * system therefore never starts with half-relinked `linkTargets`.
 */

export interface RootRenameTransition {
  /** The retired identifier. Permanently occupied from here on. */
  from: string;
  /** The identifier the space answered under immediately after this transition. */
  to: string;
  /** ISO timestamp of the commit. */
  at: string;
}

export interface RootRenameFile {
  version: 1;
  transitions: RootRenameTransition[];
}

/** The intent record a rename writes before touching anything else. */
export interface RootRenameJournal {
  from: string;
  to: string;
  startedAt: string;
}

const EMPTY: RootRenameFile = { version: 1, transitions: [] };

export function rootRenamesPath(cwd: string): string {
  return path.join(cwd, '.claude4spec', 'root-renames.json');
}

export function rootRenameJournalPath(cwd: string): string {
  return path.join(cwd, '.claude4spec', 'root-rename.journal.json');
}

/**
 * Reads the registry. A missing, empty or malformed file reads as "no
 * transitions": this is an additive sidecar, and refusing to open a project
 * because of it would make a cosmetic file fatal to a spec that is otherwise
 * intact. A malformed file is reported once on stderr so it is not silent.
 */
export function readRootRenames(cwd: string): RootRenameFile {
  const file = rootRenamesPath(cwd);
  if (!fs.existsSync(file)) return { ...EMPTY, transitions: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`[root-renames] ${file} is not valid JSON (${(err as Error).message}) — treating as empty`);
    return { ...EMPTY, transitions: [] };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...EMPTY, transitions: [] };
  }
  const raw = (parsed as Record<string, unknown>).transitions;
  if (!Array.isArray(raw)) return { ...EMPTY, transitions: [] };
  const transitions: RootRenameTransition[] = [];
  for (const t of raw) {
    if (t === null || typeof t !== 'object' || Array.isArray(t)) continue;
    const r = t as Record<string, unknown>;
    if (typeof r.from !== 'string' || typeof r.to !== 'string') continue;
    transitions.push({ from: r.from, to: r.to, at: typeof r.at === 'string' ? r.at : '' });
  }
  return { version: 1, transitions };
}

export function writeRootRenames(cwd: string, file: RootRenameFile): void {
  const target = rootRenamesPath(cwd);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  atomicWrite(target, JSON.stringify(file, null, 2) + '\n');
}

/**
 * Every identifier a rename has retired. Together with the live `roots[].id`
 * this is the "taken" set of rule 7 — the set no new or renamed space may draw
 * from.
 */
export function retiredRootIds(cwd: string): Set<string> {
  return new Set(readRootRenames(cwd).transitions.map((t) => t.from));
}

/**
 * The full identifier chain of the space that answers under `currentId` today:
 * `[currentId, ...formerIds]`, newest-retired first. This is the predicate every
 * history read uses — `WHERE rootId IN (<chain>)` — instead of comparing to a
 * single value.
 *
 * Walks `to → from` backwards. Rule 7 makes the graph acyclic, but a
 * hand-edited file could still close a loop, so the walk carries a seen-set and
 * stops rather than spinning.
 */
export function rootIdChain(transitions: readonly RootRenameTransition[], currentId: string): string[] {
  const byTo = new Map<string, string>();
  for (const t of transitions) {
    // Last writer wins: a `to` can only be produced once by an acyclic chain,
    // and if a damaged file says otherwise the newest record is the better bet.
    byTo.set(t.to, t.from);
  }
  const chain = [currentId];
  const seen = new Set([currentId]);
  let cursor = currentId;
  for (;;) {
    const previous = byTo.get(cursor);
    if (previous === undefined || seen.has(previous)) break;
    chain.push(previous);
    seen.add(previous);
    cursor = previous;
  }
  return chain;
}

/** The chain minus its head, oldest identifier first — the bundle manifest's `formerIds`. */
export function formerIdsOf(transitions: readonly RootRenameTransition[], currentId: string): string[] {
  return rootIdChain(transitions, currentId).slice(1).reverse();
}

/**
 * Where a retired identifier's chain leads today, or `null` when the value was
 * never retired. Used for the idempotent replay of a finished rename and to
 * canonicalise a historical `file_version.rootId` onto the space's live address.
 */
export function resolveCurrentRootId(
  transitions: readonly RootRenameTransition[],
  someId: string,
): string | null {
  const byFrom = new Map<string, string>();
  for (const t of transitions) byFrom.set(t.from, t.to);
  if (!byFrom.has(someId)) return null;
  let cursor = someId;
  const seen = new Set([someId]);
  for (;;) {
    const next = byFrom.get(cursor);
    if (next === undefined || seen.has(next)) break;
    cursor = next;
    seen.add(next);
  }
  return cursor;
}

/**
 * Appends one transition. Refuses a record that would close a cycle — an
 * identifier must never return to a space it has left, which is precisely what
 * makes `WHERE rootId IN (<chain>)` decidable.
 */
export function appendTransition(cwd: string, from: string, to: string): RootRenameFile {
  const current = readRootRenames(cwd);
  if (current.transitions.some((t) => t.from === from)) {
    throw new Error(`root-renames.json: '${from}' was already retired by an earlier rename`);
  }
  // Adding `from → to` closes a loop exactly when `to` is already one of
  // `from`'s own ancestors — i.e. when the identifier would return to a space
  // it has left before.
  if (rootIdChain(current.transitions, from).includes(to)) {
    throw new Error(`root-renames.json: renaming '${from}' to '${to}' would close a cycle`);
  }
  const next: RootRenameFile = {
    version: 1,
    transitions: [...current.transitions, { from, to, at: new Date().toISOString() }],
  };
  writeRootRenames(cwd, next);
  return next;
}

/** Rewrites every `linkTargets` entry pointing at `from` so it points at `to`. */
export function relinkRoots(roots: readonly Root[], from: string, to: string): { roots: Root[]; relinked: string[] } {
  const relinked: string[] = [];
  const next = roots.map((r) => {
    if (!r.linkTargets.includes(from)) return { ...r, linkTargets: [...r.linkTargets] };
    relinked.push(r.id === from ? to : r.id);
    return { ...r, linkTargets: r.linkTargets.map((t) => (t === from ? to : t)) };
  });
  return { roots: next, relinked };
}

export function readRenameJournal(cwd: string): RootRenameJournal | null {
  const file = rootRenameJournalPath(cwd);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (typeof raw.from !== 'string' || typeof raw.to !== 'string') return null;
    return { from: raw.from, to: raw.to, startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '' };
  } catch {
    return null;
  }
}

export function writeRenameJournal(cwd: string, journal: RootRenameJournal): void {
  const file = rootRenameJournalPath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, JSON.stringify(journal, null, 2) + '\n');
}

export function clearRenameJournal(cwd: string): void {
  try {
    fs.rmSync(rootRenameJournalPath(cwd), { force: true });
  } catch {
    /* best effort — a stale journal is replayed idempotently next time */
  }
}

/**
 * Crash recovery, run at project activation BEFORE anything reads `roots[]`.
 *
 * The rename's commit is: journal → config (new `id` + relinked `linkTargets`)
 * → transition record → journal cleared. A crash can therefore leave the
 * journal beside a config that has (a) already moved to the new id, or (b) not
 * moved at all.
 *
 * - (a) → finish: make sure the transition record and the relink are both there.
 * - (b) → roll back: nothing was written, so dropping the journal IS the
 *   rollback.
 *
 * Never leaves the project half-relinked, which is the state the specification
 * rules out by name.
 */
export function recoverPendingRootRename(cwd: string): 'none' | 'completed' | 'rolled-back' {
  const journal = readRenameJournal(cwd);
  if (!journal) return 'none';
  if (!fs.existsSync(configPath(cwd))) {
    clearRenameJournal(cwd);
    return 'rolled-back';
  }
  let outcome: 'completed' | 'rolled-back' = 'rolled-back';
  try {
    /**
     * The RAW file, deliberately — not `readConfig`. The exact state this
     * recovers from is a config whose `roots[]` already carries the new id while
     * some `linkTargets` still names the old one, and that shape fails the
     * dangling-link-scope rule: a validating read would throw on the very file
     * it has been called to repair.
     */
    const raw = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8')) as Record<string, unknown>;
    const roots = Array.isArray(raw.roots) ? (raw.roots as Root[]) : [];
    const moved = roots.some((r) => r?.id === journal.to);
    if (moved) {
      const { roots: relinkedRoots, relinked } = relinkRoots(roots, journal.from, journal.to);
      if (relinked.length > 0) {
        // Same shape as `migrateConfigToV4`: repair the raw object, validate the
        // REPAIRED roots, then write atomically. `writeConfig` is no use here —
        // it re-reads (and validates) the current, broken file before merging.
        parseRootsArray(relinkedRoots, { reservedIds: 'warn', idShape: 'warn' });
        raw.roots = relinkedRoots;
        atomicWrite(configPath(cwd), JSON.stringify(raw, null, 2) + '\n');
      }
      if (!readRootRenames(cwd).transitions.some((t) => t.from === journal.from)) {
        appendTransition(cwd, journal.from, journal.to);
      }
      outcome = 'completed';
    }
  } catch (err) {
    console.error(`[root-renames] could not replay the interrupted rename: ${(err as Error).message}`);
  }
  clearRenameJournal(cwd);
  console.warn(
    `[root-renames] interrupted rename '${journal.from}' → '${journal.to}' was ${outcome === 'completed' ? 'completed' : 'rolled back'} at startup`,
  );
  return outcome;
}

/**
 * Seeds a freshly cloned project's registry from a bundle manifest.
 *
 * A clone does not TRANSLATE identities — it keeps the ones the bundle carries.
 * But it must inherit the set of taken addresses: rule 7 has to hold in the
 * clone from its very first boot, or the clone could hand a retired identifier
 * to a different space and make its imported history ambiguous.
 *
 * `formerIds` arrives oldest-first, so consecutive pairs reconstruct the chain.
 * A manifest predating the field (or carrying an empty array) means "never
 * renamed" and seeds nothing.
 */
export function seedRootRenamesFromManifest(
  cwd: string,
  roots: ReadonlyArray<{ id: string; formerIds?: readonly string[] }>,
): void {
  const transitions: RootRenameTransition[] = [];
  const at = new Date().toISOString();
  for (const root of roots) {
    const chain = [...(root.formerIds ?? []), root.id];
    for (let i = 0; i + 1 < chain.length; i += 1) {
      transitions.push({ from: chain[i]!, to: chain[i + 1]!, at });
    }
  }
  if (transitions.length === 0) return;
  writeRootRenames(cwd, { version: 1, transitions });
}
