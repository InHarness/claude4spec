import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type { SelfWriteMarker, WriteActor } from '../fs/sources.js';
import type { FileVersionService } from './file-version.js';
import type { PagesService } from './pages.js';
import type { SectionsService } from './sections.js';
import { parseHeadings } from './section-indexer.js';
import { ConflictError } from './brief.js';
import { DomainError } from './tags.js';

/**
 * M02 / M06 — the page write path, as ONE function per operation.
 *
 * ## Why this file exists
 *
 * Until 0.2.13 the whole contract of writing a page lived inside three Express
 * handlers: the `PAGE_EXISTS` check, the `expectedHash` comparison, the
 * `markOrigin` → write → `flush` sequence, and the re-hash of what landed. That
 * was fine while REST was the only channel. It stops being fine the moment the
 * operation gets a second rendering: an MCP tool calling `PagesService.write`
 * directly would be a second execution locus — same file, no watcher token, no
 * optimistic-concurrency guard — which is precisely the drift this release
 * exists to remove. The catalog's hard invariant is "one function per
 * operation"; these are those functions, and every channel is an adapter over
 * them.
 *
 * ## The write token is not decoration
 *
 * `markOrigin` labels the write so M40 knows the server authored it, and
 * `flush` drives its reactions (indexers, `file_version` capture) to completion
 * BEFORE the caller is answered. A built-in `Write`/`Edit` bypasses both: the
 * file lands as a foreign change, the actor is lost, and the caller is told
 * "done" before anything has been re-indexed. That difference — not a rule in a
 * prompt — is why the built-in tools are not a page write path (item 28).
 *
 * `actor` is what makes it more than a formality. `WriteActor` has been
 * `'user' | 'agent'` since M40 landed and only `'user'` was ever passed, because
 * only REST could write. The MCP renderings pass `'agent'`, so a page's history
 * finally distinguishes the two.
 *
 * ## `expectedHash` is mandatory (0.2.15)
 *
 * It used to fire only when the caller supplied one, so a caller that omitted it
 * still got last-write-wins — a guard that any writer could opt out of guards
 * nothing against that writer. It is now required by `update_page`,
 * `update_sections` and `update_plan` alike, enforced here rather than in each
 * channel's schema, so no rendering can be laxer than another.
 *
 * The editor was the reason it stayed optional, and the reason was circular: the
 * page read returned no hash for it to send back. It does now (`PageContent.hash`),
 * and creation — the one write with nothing to guard against — has its own
 * operation, `create_page`, instead of a blank guard on this one.
 *
 * ## Nothing here answers with the page it just wrote
 *
 * Every operation used to answer `PageContent & { hash }`, so a write echoed the
 * full `body` back at whoever sent it. On `update_sections` that was at its worst:
 * the caller replaced one paragraph and got the whole page back — text it had in
 * context a moment earlier, returned at its own expense.
 *
 * The shapes below are per operation, on purpose. A shared result type is how
 * the echo got in: the widest consumer's needs became every operation's output.
 * What a write reports now is only what the caller could NOT have predicted —
 * the hash of what landed, the version the capture recorded, and which anchors
 * moved under it.
 *
 * This binds every channel, not just the agent-facing ones. L3: "the output
 * shape is the operation's, the channel adapter does not widen it" — a REST
 * handler that appends the body because it is convenient for its own front-end
 * has authored a second semantics for the same operation. A caller who needs the
 * page reads it; that is its decision and its budget.
 */

/** Everything a page write needs about the root it targets. */
export interface PageWriteTarget {
  pages: PagesService;
  /** Null only in the hand-rolled test rigs; a mounted root always has one. */
  writer: SelfWriteMarker | null;
  /**
   * The `file_version` axis this root writes to — where the reported `version`
   * is read back from. Optional for the hand-rolled test rigs, which have no db;
   * absent means the write reports version `0`, as `PlanService` already does.
   */
  versions?: FileVersionService | null;
}

export interface CreatePageInput {
  path: string;
  content?: string;
}

export interface UpdatePageInput {
  path: string;
  body: string;
  frontmatter?: Record<string, unknown>;
  expectedHash?: string;
}

/**
 * What one edit in an `update_sections` batch does.
 *
 *  - `replace`      — swap the section's body. Idempotent.
 *  - `append`       — add to the end of the section's body. NOT idempotent.
 *  - `insert_after` — add after the section, before the next heading of equal or
 *                     higher level. NOT idempotent.
 *  - `delete`       — remove the section: heading, anchor comment and body.
 *                     Idempotent, and the ONLY action that takes no `content`.
 *
 * Every one of them addresses the section WITH ITS SUBTREE, not the prose under
 * the heading. A section's range runs to the next heading of equal-or-higher
 * level, so it contains its descendants — a `replace` on a `##` carrying three
 * `###` replaces all four sections, and a `delete` removes all four. To change
 * only a parent's preamble, either reproduce the subsections in the new
 * `content` or edit the subsections separately.
 *
 * `append` is the exception in practice, not in principle: it splices at the end
 * of the section's OWN text (before the first descendant heading), because
 * appending to a parent underneath its last grandchild would be adding to a
 * different section than the one addressed.
 */
export type SectionEditAction = 'replace' | 'append' | 'insert_after' | 'delete';

export const SECTION_EDIT_ACTIONS: readonly SectionEditAction[] = [
  'replace',
  'append',
  'insert_after',
  'delete',
];

export interface SectionEdit {
  anchor: string;
  action: SectionEditAction;
  /**
   * The text this edit contributes — everything under the heading, heading line
   * excluded. Exactly what `get_sections` hands back, so a read → edit → write
   * round-trip is lossless. See {@link updateSections} for why the heading is
   * not part of it.
   *
   * Required for every action but `delete`, which addresses a section and
   * carries nothing.
   */
  content?: string;
}

export interface UpdateSectionsInput {
  /**
   * 0.2.15 — REQUIRED. The hash of the PAGE, not of a section: this operation is
   * a read-modify-write of the whole page, so there is no separate section
   * version to be stale against.
   */
  expectedHash: string;
  edits: SectionEdit[];
  /**
   * 0.2.17 — the anchors this batch is ALLOWED to destroy.
   *
   * A `replace` or `delete` addresses a section together with its subtree, so it
   * takes the anchor comments of every descendant heading with it. That was
   * silent: the anchors vanished from `section_index`, and anything citing one —
   * a `<section_ref/>`, a `@page.md#anchor` link — broke, to be discovered later
   * by `check_consistency` or not at all.
   *
   * Naming an anchor here is the caller saying "yes, that identity goes away".
   * It is required only for dropped anchors that HAVE referents; dropping an
   * unreferenced anchor needs no declaration, it is merely reported back. The
   * guard has no off switch — see {@link updateSections}.
   */
  dropAnchors?: string[];
}

/**
 * `create_page` — the page did not exist, so every anchor on it is new to the
 * caller: it sent markdown without any, and the indexer minted the lot.
 *
 * `rootId` and `path` are here and nowhere else because creation is the one
 * moment the caller learns the page's identity as the server records it.
 */
export interface CreatePageResult {
  rootId: string;
  path: string;
  hash: string;
  /** Every anchor the page now carries, in document order. */
  anchors: string[];
}

/** `update_page` — a whole-page write. Identity was already known; only the delta is news. */
export interface UpdatePageResult {
  hash: string;
  version: number;
  /** Anchors added, removed, or whose section text changed. See {@link anchorDelta}. */
  changedAnchors: string[];
}

/** One edit's outcome inside an {@link UpdateSectionsResult}. */
export interface SectionEditResult {
  anchor: string;
  action: SectionEditAction;
  /**
   * Anchors OTHER than the edited one that moved or changed under this edit. The
   * edited anchor is already `anchor` above and is not repeated here.
   */
  affectedAnchors: string[];
  /**
   * Anchors this edit removed from `section_index` — the subtree identities it
   * destroyed, including its own when the action was `delete`.
   *
   * Present on SUCCESS, not only in a refusal, and that is the point: it is what
   * replaces a dry-run mode. The guard refuses on one branch only (a dropped
   * anchor with referents and no `dropAnchors`), so a caller who wants to know
   * what a write cost in identities reads it off the write itself.
   *
   * Empty for `append` / `insert_after`, which never span a subtree.
   */
  droppedAnchors: string[];
}

/**
 * `update_sections` — a batch of punctual writes to ONE page. Neither the new
 * sections nor the page comes back.
 *
 * `path` identifies the page every edit landed on — the caller addressed
 * anchors, not a page, so this is the one part of its own request it did not
 * state. `hash` arms the next call's `expectedHash`.
 */
export interface UpdateSectionsResult {
  path: string;
  hash: string;
  version: number;
  /** In the order the edits were GIVEN, not the order they were applied. */
  results: SectionEditResult[];
}

/** What `commit` hands its three callers to build their own, narrower answers from. */
interface CommitResult {
  hash: string;
  version: number;
  /** Anchors as they stand AFTER the write, in document order. */
  anchors: string[];
  /** Per-anchor digest of the section text after the write, for the delta. */
  digests: Map<string, string>;
}

/** sha256 of a file's bytes, or null when it does not exist. */
async function hashOf(pages: PagesService, relPath: string): Promise<string | null> {
  try {
    return sha256(await fs.readFile(path.join(pages.root, relPath), 'utf-8'));
  } catch {
    return null;
  }
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * The shared tail of every write: label it, write it, drive the reactions,
 * re-read what landed.
 *
 * The re-read is not paranoia — `PagesService.write` serializes frontmatter
 * through gray-matter, so the bytes on disk are not the bytes handed in, and a
 * caller who hashes what it SENT would fail its own next `expectedHash`.
 */
async function commit(
  target: PageWriteTarget,
  relPath: string,
  actor: WriteActor,
  input: { body: string; frontmatter?: Record<string, unknown> },
): Promise<CommitResult> {
  target.writer?.markOrigin(relPath, actor);
  await target.pages.write(relPath, input);
  await target.writer?.flush(relPath);
  const written = await fs.readFile(path.join(target.pages.root, relPath), 'utf-8');
  /**
   * The body is re-parsed rather than taken from the input because `flush` has
   * already run the `write-back` phase, which INJECTS anchors the indexer minted
   * for new headings. Those are the anchors the caller could not predict, so
   * they must be read off what landed, not off what was sent.
   */
  const body = matter(written).content;
  return {
    hash: sha256(written),
    version: currentVersionOf(target, relPath),
    anchors: [...sectionRanges(body.split('\n'))].map((r) => r.anchor),
    digests: sectionDigests(body),
  };
}

/**
 * The version the capture just recorded — read back, not guessed.
 *
 * Safe to read synchronously here because `commit` awaits `writer.flush()`,
 * which drives the reaction chain (`projection → notification → reload →
 * write-back → capture`) to completion, bypassing the watcher's debounce. By the
 * time this runs the `file_version` row exists. Same read `PlanService`
 * already does for a plan's current version.
 *
 * `0` when there is no row: capture failures are warned and swallowed
 * (`file-version-capture.ts`), and the hand-rolled test rigs have no db at all.
 * A write must not fail because its bookkeeping did.
 */
function currentVersionOf(target: PageWriteTarget, relPath: string): number {
  return target.versions?.getLatestForPath(relPath, undefined, target.pages.rootId)?.version ?? 0;
}

export async function createPage(
  target: PageWriteTarget,
  input: CreatePageInput,
  actor: WriteActor,
): Promise<CreatePageResult> {
  const relPath = input.path;
  if (!relPath) throw new DomainError('VALIDATION', 'path required');
  if (await target.pages.exists(relPath)) {
    throw new DomainError(
      'PAGE_EXISTS',
      `page '${relPath}' already exists`,
      `update it with update_page({ rootId: "${target.pages.rootId}", path: "${relPath}", body }) instead`,
    );
  }
  const written = await commit(target, relPath, actor, { body: input.content ?? '' });
  return { rootId: target.pages.rootId, path: relPath, hash: written.hash, anchors: written.anchors };
}

export async function updatePage(
  target: PageWriteTarget,
  input: UpdatePageInput,
  actor: WriteActor,
): Promise<UpdatePageResult> {
  const relPath = input.path;
  if (!relPath) throw new DomainError('VALIDATION', 'path required');
  if (typeof input.body !== 'string') throw new DomainError('VALIDATION', 'body required');
  await assertUnchanged(target, relPath, input.expectedHash);
  // Read BEFORE writing: the delta is against what was on disk, and this doubles
  // as create-or-replace, so "no page yet" means every anchor is an addition.
  const before = sectionDigests(await bodyOnDisk(target.pages, relPath));
  const written = await commit(target, relPath, actor, {
    body: input.body,
    ...(input.frontmatter !== undefined ? { frontmatter: input.frontmatter } : {}),
  });
  return {
    hash: written.hash,
    version: written.version,
    changedAnchors: anchorDelta(before, written.digests),
  };
}

/** A page's body as it currently stands, or empty when it is not there yet. */
async function bodyOnDisk(pages: PagesService, relPath: string): Promise<string> {
  try {
    return (await pages.read(relPath)).body;
  } catch {
    return '';
  }
}

/**
 * The guard, shared by `update_page` and `update_sections`.
 *
 * 0.2.15 — `expectedHash` is REQUIRED, on every channel, and this is where that
 * is enforced rather than in each channel's schema: a guard only some doors
 * apply is not a guard. Two distinct refusals:
 *
 *  - MISSING → `INVALID_ARGUMENT`. Retrying the same call can never work; the
 *    caller has to go read the page first.
 *  - MISMATCHED → `PAGE_CONFLICT` (409) carrying the current hash, which is
 *    what the retry needs.
 *
 * A missing FILE is still not a conflict: `update_page` doubles as
 * create-or-replace, and there is nothing to have changed underneath the caller.
 * The hash is still demanded in that case — a caller that believes it is
 * editing an existing page and is actually creating one has made a mistake
 * worth surfacing, and one it cannot detect from a silent success.
 */
async function assertUnchanged(
  target: PageWriteTarget,
  relPath: string,
  expectedHash: string | undefined,
): Promise<void> {
  if (typeof expectedHash !== 'string' || expectedHash.length === 0) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'expectedHash is required',
      `read the page first (get_page) and pass back its \`hash\`; for a page that does not exist yet, create it with create_page({ rootId: "${target.pages.rootId}", path: "${relPath}" })`,
    );
  }
  const currentHash = await hashOf(target.pages, relPath);
  if (currentHash === null || currentHash === expectedHash) return;
  throw new ConflictError('PAGE_CONFLICT', 'page changed since last read', currentHash);
}

export async function deletePage(
  target: PageWriteTarget,
  input: { path: string },
  actor: WriteActor,
): Promise<{ ok: true; deleted: boolean }> {
  const relPath = input.path;
  if (!relPath) throw new DomainError('VALIDATION', 'path required');
  /**
   * Deleting a page that is not there is a SUCCESS, and `deleted: false` says
   * so.
   *
   * The catalog declares this operation idempotent, and it has to actually be:
   * without this guard a repeat call reached `fs.unlink`, threw a raw ENOENT and
   * came back 500 INTERNAL — the one status that tells a client "the server
   * broke, retry" about the one situation where retrying can never help. A
   * caller retrying after a timeout is exactly who hits it.
   *
   * Reported rather than swallowed, because "already gone" and "you typed the
   * wrong path" produce the same answer here and a caller may want to tell them
   * apart.
   */
  if (!(await target.pages.exists(relPath))) return { ok: true, deleted: false };
  /**
   * Deletes go through `markOrigin` + `flush` like every other server write,
   * and must NOT suppress. A suppress token issued here has no event of its own
   * to be consumed by if the file is re-created immediately, and would then
   * swallow that re-create — leaving no version row at all. `capture` authors
   * the tombstone, synthesizing content from the last version.
   */
  target.writer?.markOrigin(relPath, actor);
  await target.pages.remove(relPath);
  await target.writer?.flush(relPath, 'unlink');
  return { ok: true, deleted: true };
}

/** Who cites a section: one page, and the section of it the citation sits in. */
export interface SectionReferent {
  page: string;
  anchor?: string;
}

export interface SectionWriteDeps {
  sections: SectionsService;
  /** Resolves the root the addressed section lives on. */
  resolveRoot: (rootId: string) => PageWriteTarget | undefined;
  /**
   * Who cites this anchor — `find_references({ target: 'section', anchor })`,
   * the same sweep `check_consistency`'s broken-reference rule runs, called
   * BEFORE the write instead of after it. The guard builds no reference
   * machinery of its own; it only asks the question earlier.
   *
   * Optional because the hand-rolled rigs that mount the section router for its
   * read routes have no discovery core to hand over. Absent, the guard still
   * REPORTS `droppedAnchors` but cannot refuse — it has no way to know whether
   * an anchor is cited, and inventing "nothing cites it" would be a guard that
   * lies. A real project always wires it.
   */
  findSectionReferents?: (anchor: string) => Promise<SectionReferent[]>;
}

/** One doomed anchor and who would be left pointing at nothing. */
export interface AnchorLoss {
  anchor: string;
  headingText: string;
  referencedBy: SectionReferent[];
}

/**
 * `ANCHOR_LOSS` — the batch would destroy an anchor that something else cites,
 * and the caller has not said it means to.
 *
 * A `DomainError` (400), NOT a `ConflictError` (409), and the distinction is the
 * repair path rather than taxonomy for its own sake. `PAGE_CONFLICT` means "your
 * hash is stale, re-read and retry" — the same request succeeds on the second
 * attempt. This refusal is deterministic: replaying it byte-for-byte refuses
 * again, forever, until the REQUEST changes. Two repairs exist, both the
 * caller's to choose: declare the anchors in `dropAnchors`, or send `content`
 * that reproduces them.
 *
 * `details` carries a structure, not a list of ids: an anchor is an opaque
 * 8-character token, so "you would break `k3f9a1x2`" is not something a human or
 * an agent can act on. The heading text says what it was, and `referencedBy`
 * says whose links go dead.
 */
export class AnchorLossError extends DomainError {
  readonly details: AnchorLoss[];
  constructor(details: AnchorLoss[]) {
    const names = details.map((d) => `'${d.headingText}' (${d.anchor})`).join(', ');
    super(
      'ANCHOR_LOSS',
      `this batch would drop ${details.length === 1 ? 'a referenced section' : 'referenced sections'}: ${names}`,
      'pass the anchors in dropAnchors to accept the loss, or send content that reproduces their anchor comments',
    );
    this.name = 'AnchorLossError';
    this.details = details;
  }
}

/**
 * Where the anchored section lives in THESE lines: `[lineStart, lineEnd)`,
 * 1-based start (the heading line), exclusive end — the same pair
 * `section_index` stores, recomputed from the file.
 *
 * The end rule is the indexer's, not an approximation of it: a section runs to
 * the next heading of equal or higher level, and stops at that heading's ANCHOR
 * comment when it has one, so the neighbour's anchor is never inside the range.
 * Duplicating five lines from `section-indexer.ts` would be exactly the drift
 * this release exists to remove, so the parser is imported and only the walk
 * lives here.
 */
function liveRangeOf(lines: string[], anchor: string): { lineStart: number; lineEnd: number } | null {
  return sectionRanges(lines).find((r) => r.anchor === anchor) ?? null;
}

/**
 * Every anchored section's line range in THESE lines, in document order — the
 * walk `liveRangeOf` used to do for one anchor, done once for all of them.
 *
 * Factored out because the anchor delta needs the ranges of every section, not
 * of one; running the same walk twice with two slightly different end rules is
 * how the section index and the write path would drift apart again.
 */
function sectionRanges(lines: string[]): Array<{ anchor: string; lineStart: number; lineEnd: number }> {
  const headings = parseHeadings(lines);
  /**
   * Hand-authored anchors are unpoliced, so the same value can appear twice on
   * one page. `buildSections` in the indexer settles that the same way — first
   * occurrence owns the anchor, the rest get no row — and this has to agree with
   * it, not merely resemble it: `liveRangeOf` takes the first match, so a delta
   * keyed on the last one would report a section the splice never touched and
   * the index does not own.
   */
  const claimed = new Set<string>();
  return headings.flatMap((self, idx) => {
    if (!self.anchor || claimed.has(self.anchor)) return [];
    claimed.add(self.anchor);
    let lineEnd = lines.length;
    for (let j = idx + 1; j < headings.length; j++) {
      const next = headings[j]!;
      if (next.level <= self.level) {
        lineEnd = next.anchorLineIndex ?? next.lineIndex;
        break;
      }
    }
    return [{ anchor: self.anchor, lineStart: self.lineIndex + 1, lineEnd }];
  });
}

/**
 * Digest of each section's OWN text — its lines down to the next heading of any
 * level, descendants excluded.
 *
 * Not the index's range rule, and deliberately so. A section's indexed range
 * runs to the next heading of equal-or-higher level, so it CONTAINS its
 * subsections: under that rule, editing a paragraph three levels down also
 * "changes" every ancestor up to the page's title, and a caller asking which
 * anchors moved would be handed its own ancestry every time. An ancestor
 * containing your edit is the one thing you could have predicted, which is
 * exactly what this answer is not for.
 */
/**
 * Where a section's OWN text ends: the first heading at or after its body, or
 * the end of its range when it has no descendants. Shared by `append` and by
 * `sectionDigests` so the two cannot drift apart.
 */
function ownEndOf(lines: string[], range: { lineStart: number; lineEnd: number }): number {
  const nextHeading = parseHeadings(lines)
    .map((h) => h.anchorLineIndex ?? h.lineIndex)
    .find((s) => s >= range.lineStart);
  return Math.min(range.lineEnd, nextHeading ?? range.lineEnd);
}

function sectionDigests(body: string): Map<string, string> {
  const lines = body.split('\n');
  const starts = parseHeadings(lines).map((h) => h.anchorLineIndex ?? h.lineIndex);
  const out = new Map<string, string>();
  for (const r of sectionRanges(lines)) {
    const nextHeading = starts.find((s) => s >= r.lineStart);
    out.set(r.anchor, sha256(lines.slice(r.lineStart, Math.min(r.lineEnd, nextHeading ?? r.lineEnd)).join('\n')));
  }
  return out;
}

/**
 * Which anchors a write actually moved: added, removed, or textually changed.
 *
 * The specification declares the FIELDS (`changedAnchors`, `affectedAnchors`)
 * without defining what belongs in them, so this is the reading the echo-free
 * rule implies — a write reports "what the caller could not have predicted" —
 * filed back as a clarification patch.
 *
 * Order is the after-state's document order, with anchors that disappeared
 * appended in their old document order: a removed anchor has no position in a
 * page it is no longer on, and dropping it entirely would hide the one change a
 * caller is least able to infer.
 */
function anchorDelta(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed = [...after.keys()].filter((a) => before.get(a) !== after.get(a));
  const removed = [...before.keys()].filter((a) => !after.has(a));
  return [...changed, ...removed];
}

/**
 * M06 `update_sections` — a BATCH of punctual writes to one page. A convenience
 * over `update_page`, not a second store.
 *
 * The brief is explicit that a section is not a structural gap in the data
 * model: this reads the whole page, splices each edit over its addressed
 * section's line range, and writes the whole page back with the SAME primitive.
 * Which is why the `expectedHash` it takes is the PAGE's hash — there is no
 * separate section version to be stale against, and inventing one would be the
 * second store the brief rules out.
 *
 * ## Why a batch, and why the name changed
 *
 * 0.2.15: the singular `update_section` was called repeatedly against different
 * anchors of the same page, and every one of those calls was a whole
 * read-modify-write. Worse, each one invalidated the next: after call 1 the
 * caller's `expectedHash` is stale, so it either re-read between every edit or
 * skipped the guard. Batching is therefore a correctness fix, not an
 * ergonomics one — one hash guards the whole set.
 *
 * Renaming to the plural changes the operation's identifier, which is the cost
 * paid here deliberately rather than discovered later.
 *
 * There is NO batch across pages. `create_page` / `update_page` / `delete_page`
 * stay single-target; batching happens strictly inside one page, which is what
 * makes one `expectedHash` meaningful.
 *
 * ## Transactional, which is the ONE exception to M13's partial-success rule
 *
 * Every other batch in this system reports per-item results and lets the good
 * items through (`entity-tools` is the model). This one does not, because the
 * items are not independent: they all rewrite the same file, so a "successful"
 * subset is a page in a state no caller asked for, and the `hash` that comes
 * back would describe it. Either the whole set lands or none of it does — and
 * since nothing is written until every edit has been spliced in memory, a
 * failure leaves the file untouched rather than needing a rollback.
 *
 * ## Applied bottom-up, whatever order they arrive in — and re-measured each time
 *
 * An edit changes the line count, which moves every section BELOW it. Applying
 * in the caller's order would mean each splice landing on coordinates the
 * previous splice invalidated. Descending by `lineStart` fixes the direction:
 * an edit never moves a section that has not been spliced yet.
 *
 * Direction alone is not enough, and the first version of this got that wrong.
 * Bottom-up is only self-sufficient for DISJOINT ranges, and these ranges are
 * not disjoint: a section's range runs to the next heading of equal-or-higher
 * level, so it CONTAINS its subsections. A batch naming both `## Outer` and its
 * child `### Inner` therefore shrinks or grows Outer's range while spliced
 * against the child — and Outer's stale `lineEnd`, applied afterwards, eats
 * whatever now sits past the real end: the next sibling's `<!-- anchor -->`
 * comment and heading, silently, answered with a 200 and a fresh hash. So each
 * range is re-measured against the CURRENT lines immediately before its own
 * splice. The pre-pass below still locates every anchor first, because a batch
 * that cannot be applied in full must fail before anything is spliced.
 *
 * `results` is nevertheless returned in the order the edits were GIVEN — the
 * application order is an implementation detail the caller did not choose.
 *
 * ## The heading is not replaceable through here, on purpose
 *
 * `section_index` stores a section as `[lineStart .. lineEnd]`, 1-based
 * inclusive, where `lineStart` IS the heading line and `lineEnd` is the last
 * line before the next sibling's `<!-- anchor -->` comment. `replace` / `append`
 * / `insert_after` touch only what is strictly BELOW the heading, for two
 * reasons that point the same way:
 *
 *  - `get_sections` returns the body without the heading (`rawBody =
 *    sectionLines.slice(1)`), so read → edit → write only round-trips if this
 *    writes back the same shape. Taking the heading here would make an agent
 *    that echoed what it read delete the heading.
 *  - the heading text is the section's IDENTITY — `headingSlug`, `headingPath`,
 *    and (through a rename) anchor propagation across every root all hang off
 *    it. A "punctual section edit" quietly restructuring the page is not a
 *    convenience. Rewriting a heading is an `update_page` call, where it is
 *    visible.
 *
 * `delete` is the deliberate exception: it removes the heading and the anchor
 * comment along with the body, because a section whose heading survived would
 * not have been deleted. That is visible in the verb, which is the difference.
 *
 * ## The line ranges come from the FILE, not from the index
 *
 * The index rows answer "which page, on which root" and drive the not-found
 * refusal. The ranges that get spliced are recomputed from the bytes about to be
 * written, with `parseHeadings` — the indexer's own parser — and the indexer's
 * own end rule.
 *
 * A first version trusted `row.lineStart`/`row.lineEnd` and only bounds-checked
 * them, which is a guard against the loud failure and none at all against the
 * quiet one. `section_index` is maintained by a watcher, so it trails the file
 * by however long a reaction takes, and any edit outside this operation — a
 * `git checkout`, a hand edit, an editor save still in flight — moves the
 * boundaries. When the file stays long enough for the stale range to remain in
 * bounds, the splice lands on whatever now occupies those lines: it eats the
 * tail of the previous section, or the heading and anchor comment of the next
 * one, and answers 200 with a fresh hash. The caller has no way to know, and the
 * destroyed anchor takes every reference to it down with it.
 */
export async function updateSections(
  deps: SectionWriteDeps,
  input: UpdateSectionsInput,
  actor: WriteActor,
): Promise<UpdateSectionsResult> {
  const edits = input.edits;
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new DomainError('INVALID_ARGUMENT', 'edits must be a non-empty array');
  }

  const seen = new Set<string>();
  for (const edit of edits) {
    if (!edit?.anchor) throw new DomainError('VALIDATION', 'each edit requires an anchor');
    if (!SECTION_EDIT_ACTIONS.includes(edit.action)) {
      throw new DomainError(
        'INVALID_ARGUMENT',
        `unknown action '${edit.action}' — expected one of ${SECTION_EDIT_ACTIONS.join(' | ')}`,
      );
    }
    if (edit.action !== 'delete' && typeof edit.content !== 'string') {
      throw new DomainError('VALIDATION', `edit for '${edit.anchor}' requires content for action '${edit.action}'`);
    }
    /**
     * Two edits to one anchor in one batch is refused rather than folded.
     * Bottom-up application makes their combined effect depend on an ordering
     * the caller did not choose, and there is no reading of "replace it, then
     * append to it" that is not the caller having meant one call.
     */
    if (seen.has(edit.anchor)) {
      throw new DomainError('INVALID_ARGUMENT', `anchor '${edit.anchor}' appears more than once in edits`);
    }
    seen.add(edit.anchor);
  }

  const located = edits.map((edit) => {
    const section = deps.sections.getByAnchor(edit.anchor);
    if (!section) {
      throw new DomainError(
        'SECTION_NOT_FOUND',
        `section '${edit.anchor}' not found`,
        'list the anchors of a page with list_sections({ by: "page", rootId, path })',
      );
    }
    return { edit, section };
  });

  /**
   * One page per batch. Anchors are globally unique, so a caller CAN name two
   * anchors from two pages and would have no reason to expect the refusal —
   * hence a message that names both pages rather than a bare code. One
   * `expectedHash` cannot guard two files, which is the whole reason for the
   * restriction.
   */
  const first = located[0]!.section;
  const stray = located.find(
    (l) => l.section.pagePath !== first.pagePath || l.section.rootId !== first.rootId,
  );
  if (stray) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `all anchors must be on one page: '${first.anchor}' is on '${first.pagePath}' but '${stray.section.anchor}' is on '${stray.section.pagePath}'`,
      'split the batch into one update_sections call per page',
    );
  }

  const target = deps.resolveRoot(first.rootId);
  if (!target) {
    throw new DomainError(
      'ROOT_NOT_FOUND',
      `section '${first.anchor}' is indexed on root '${first.rootId}', which is not mounted`,
    );
  }

  /**
   * Before the hash guard, because the hash guard cannot express this.
   *
   * `assertUnchanged` reads an unreadable file as "nothing to have changed
   * underneath you" — correct for `update_page`, which doubles as create — and
   * then this function reads the page unconditionally. So a caller who did
   * everything right, `expectedHash` included, sailed past the guard and hit a
   * raw ENOENT from `read()`, which is not a `DomainError` and therefore
   * rendered as `500 INTERNAL`: the server telling a client to retry the one
   * situation where retrying can never work. A section indexed on a page that is
   * gone is a stale index, and says so.
   */
  if (!(await target.pages.exists(first.pagePath))) {
    throw new DomainError(
      'SECTION_NOT_FOUND',
      `section '${first.anchor}' is indexed on '${first.pagePath}', which no longer exists`,
      'the section index is behind the filesystem — re-list the page with list_sections({ by: "page", rootId, path })',
    );
  }

  await assertUnchanged(target, first.pagePath, input.expectedHash);
  const page = await target.pages.read(first.pagePath);
  const lines = page.body.split('\n');

  // The index is built over the page BODY (frontmatter stripped), which is what
  // `read()` returns — so `parseHeadings` here sees the same lines the indexer
  // saw, and 1-based `lineStart` is `lineIndex + 1` on both sides.
  const startOfAnchor = new Map(sectionRanges(lines).map((r) => [r.anchor, r.lineStart]));
  /**
   * The refusal carries the file's hash, not an empty string. `expectedHash`
   * just matched, so this IS the hash the caller already holds — but a client
   * following the documented recovery ("mismatch → PAGE_CONFLICT carrying the
   * current hash, which is what the retry needs") reads it back out of the
   * envelope, and handing it `''` turns a recoverable 409 into an
   * `INVALID_ARGUMENT` on the retry.
   */
  const currentHash = (await hashOf(target.pages, first.pagePath)) ?? '';
  for (const { edit } of located) {
    if (!startOfAnchor.has(edit.anchor)) {
      throw new ConflictError(
        'PAGE_CONFLICT',
        `anchor '${edit.anchor}' is not in '${first.pagePath}' any more — the section index is behind the file`,
        currentHash,
      );
    }
  }

  // Descending by start line, re-measuring each range: see "Applied bottom-up"
  // above for why the direction alone is not enough.
  const order = [...located].sort(
    (a, b) => startOfAnchor.get(b.edit.anchor)! - startOfAnchor.get(a.edit.anchor)!,
  );
  /**
   * Anchors the batch is ABOUT — per edit, everything inside the range it is
   * about to splice.
   *
   * Captured here, before the splice, because after it the range is gone; and
   * per edit rather than batch-wide, because unlike `affectedAnchors` this one
   * CAN be attributed. Every anchor is measured inside the one range that was
   * overwritten, so no guessing after the fact is involved.
   *
   * `delete` includes the addressed anchor itself — it takes its own heading and
   * anchor comment with it. `replace` does not: the heading and its anchor
   * comment survive the splice, only the body below them is overwritten.
   */
  const scopeOf = new Map<string, string[]>();
  for (const { edit } of order) {
    const range = liveRangeOf(lines, edit.anchor);
    if (!range) {
      throw new ConflictError(
        'PAGE_CONFLICT',
        `anchor '${edit.anchor}' was removed by an earlier edit in the same batch`,
        currentHash,
      );
    }
    const inRange = sectionRanges(lines)
      .filter((r) => r.lineStart > range.lineStart && r.lineStart < range.lineEnd)
      .map((r) => r.anchor);
    scopeOf.set(edit.anchor, edit.action === 'delete' ? [edit.anchor, ...inRange] : inRange);
    applySectionEdit(lines, edit, range);
  }

  /**
   * The guard. Runs on the spliced lines but BEFORE `commit` — a refusal here
   * leaves the file untouched, which is what makes the batch transactional
   * against anchor loss as well as against a stale hash.
   *
   * "Dropped" is decided BY THE INDEX, not by a text diff: an anchor counts as
   * lost only if it is absent from the section ranges the page will have after
   * the write. So `content` that reproduces an anchor comment keeps that anchor —
   * even under a different heading, at a different depth, in a different order.
   * Which heading it then belongs to is the adjacency rule's question, and a
   * different one from this: the guard is about identities surviving, not about
   * where they land.
   */
  const finalAnchors = new Set(sectionRanges(lines).map((r) => r.anchor));
  const droppedOf = new Map<string, string[]>(
    [...scopeOf].map(([anchor, scope]) => [anchor, scope.filter((a) => !finalAnchors.has(a))]),
  );

  /**
   * `dropAnchors` is validated against the batch's SCOPES, not against the
   * anchors actually dropped, and the asymmetry is deliberate.
   *
   * Too wide is fine: a superset inside the scopes passes. That is what keeps
   * `replace` idempotent — the second call with a refreshed hash drops nothing,
   * and the declaration it repeats verbatim must not become an error for having
   * come true. That replay is also why an anchor NO LONGER ON THE PAGE is not a
   * stranger: on the second call the children it names are already gone, so
   * "must be in scope" read strictly would reject a batch for succeeding once.
   *
   * A stranger is an anchor that is on this page and OUTSIDE every addressed
   * range — the caller declaring a loss the batch could not cause. That is not
   * ignored, because silently accepting it lets a typo'd anchor stand in for the
   * one that actually needed declaring, and the write then goes through having
   * declared nothing.
   */
  const declared = new Set(input.dropAnchors ?? []);
  const inScope = new Set([...scopeOf.values()].flat());
  const onPage = new Set(startOfAnchor.keys());
  const stranger = [...declared].find((a) => onPage.has(a) && !inScope.has(a));
  if (stranger !== undefined) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `dropAnchors names '${stranger}', which none of this batch's sections contains`,
      'dropAnchors may only name anchors inside the sections the edits address',
    );
  }

  const undeclared = [...new Set([...droppedOf.values()].flat())].filter((a) => !declared.has(a));
  if (undeclared.length > 0 && deps.findSectionReferents) {
    const losses: AnchorLoss[] = [];
    for (const anchor of undeclared) {
      const referencedBy = await deps.findSectionReferents(anchor);
      if (referencedBy.length === 0) continue;
      losses.push({
        anchor,
        headingText: deps.sections.getByAnchor(anchor)?.headingText ?? '',
        referencedBy,
      });
    }
    /**
     * The WHOLE batch, not the offending edit. Every edit rewrote the same file
     * under one `expectedHash`, so there is no partial application to fall back
     * to — and a caller told "3 of your 4 edits landed" would have to diff the
     * page to find out which.
     */
    if (losses.length > 0) throw new AnchorLossError(losses);
  }

  const before = sectionDigests(page.body);
  const written = await commit(target, first.pagePath, actor, {
    body: lines.join('\n'),
    ...(Object.keys(page.frontmatter).length > 0 ? { frontmatter: page.frontmatter } : {}),
  });

  /**
   * One delta for the whole batch, filtered per edit.
   *
   * Attributing a change to the individual edit that caused it is not possible
   * after the fact — the edits share a file and their effects overlap — and
   * pretending otherwise would be a more confident answer than the data
   * supports. What each row can honestly say is "these anchors moved, and yours
   * is not among them".
   */
  const affected = anchorDelta(before, written.digests);
  return {
    path: first.pagePath,
    hash: written.hash,
    version: written.version,
    results: edits.map((edit) => ({
      anchor: edit.anchor,
      action: edit.action,
      affectedAnchors: affected.filter((a) => a !== edit.anchor),
      droppedAnchors: droppedOf.get(edit.anchor) ?? [],
    })),
  };
}

/**
 * Splice ONE edit into `lines`, in place.
 *
 * `range.lineStart` is the heading line 1-based, so `lineStart` as a 0-based
 * index is the first line BELOW the heading — which is why `replace` starts
 * there and leaves the heading and its anchor comment (which sits above
 * `lineStart`) untouched.
 */
function applySectionEdit(
  lines: string[],
  edit: SectionEdit,
  range: { lineStart: number; lineEnd: number },
): void {
  const body = (edit.content ?? '').split('\n');
  switch (edit.action) {
    case 'replace':
      lines.splice(range.lineStart, range.lineEnd - range.lineStart, ...body);
      return;
    case 'append': {
      /**
       * The end of the section's OWN prose — before its first subsection, not
       * after the whole subtree. The range runs to the next heading of
       * equal-or-higher level, so it CONTAINS the descendants; splicing at
       * `lineEnd` would drop an `append` to a parent section underneath its
       * last `###` child, in a different section than the one addressed.
       *
       * Same end rule as `sectionDigests`, which is the point: "this section's
       * own text" has to mean one thing across the file.
       */
      lines.splice(ownEndOf(lines, range), 0, ...body);
      return;
    }
    case 'insert_after':
      /**
       * After the whole subtree — a section's range contains its subsections,
       * so `lineEnd` is exactly that position. For a leaf section this
       * coincides with `append`.
       */
      lines.splice(range.lineEnd, 0, ...body);
      return;
    case 'delete': {
      /**
       * The heading and the anchor comment go too — a section whose heading
       * survived would not have been deleted. The anchor comment sits on the
       * line above the heading when there is one, so the cut starts one line
       * earlier in that case.
       */
      const headingIdx = range.lineStart - 1;
      const anchorIdx =
        headingIdx > 0 && /^\s*<!--\s*anchor:/.test(lines[headingIdx - 1] ?? '')
          ? headingIdx - 1
          : headingIdx;
      lines.splice(anchorIdx, range.lineEnd - anchorIdx);
      return;
    }
  }
}
