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
 * ## `expectedHash` is optional, and that is a decision
 *
 * The guard fires only when the caller supplies the hash. Requiring it would
 * break the editor, which does not send one (`client/lib/api.ts`), and the
 * brief calls the guard "part of the operation contract" rather than mandatory.
 * So it is declared in every channel's schema and honoured identically in all of
 * them — but a caller who omits it still gets last-write-wins. Raised as a patch
 * against the brief. (`update_brief` is deliberately stricter — it has no legacy
 * caller to protect, so there the hash is mandatory.)
 *
 * ## Nothing here answers with the page it just wrote
 *
 * Every operation used to answer `PageContent & { hash }`, so a write echoed the
 * full `body` back at whoever sent it. On `update_section` that was at its worst:
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

export interface UpdateSectionInput {
  anchor: string;
  /**
   * The section's replacement BODY — everything under the heading, heading line
   * excluded. Exactly what `get_sections` hands back, so a read → edit → write
   * round-trip is lossless. See {@link updateSection} for why the heading is not
   * part of it.
   */
  content: string;
  expectedHash?: string;
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

/** `update_section` — a punctual write. Neither the new section nor the page comes back. */
export interface UpdateSectionResult {
  anchor: string;
  hash: string;
  version: number;
  /**
   * Anchors OTHER than the edited one that moved or changed under the edit. The
   * edited anchor is already `anchor` above and is not repeated here.
   */
  affectedAnchors: string[];
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
 * The guard, factored out because `update_section` needs the SAME one.
 *
 * A missing file is not a conflict: `update_page` doubles as create-or-replace
 * (the editor saves a new page this way), and there is nothing to have changed
 * underneath the caller. Only an EXISTING file whose hash disagrees is one.
 */
async function assertUnchanged(
  target: PageWriteTarget,
  relPath: string,
  expectedHash: string | undefined,
): Promise<void> {
  if (typeof expectedHash !== 'string') return;
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

export interface SectionWriteDeps {
  sections: SectionsService;
  /** Resolves the root the addressed section lives on. */
  resolveRoot: (rootId: string) => PageWriteTarget | undefined;
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
function sectionDigests(body: string): Map<string, string> {
  const lines = body.split('\n');
  const starts = parseHeadings(lines).map((h) => h.anchorLineIndex ?? h.lineIndex);
  const out = new Map<string, string>();
  for (const r of sectionRanges(lines)) {
    const nextHeading = starts.find((s) => s >= r.lineStart);
    const ownEnd = Math.min(r.lineEnd, nextHeading ?? r.lineEnd);
    out.set(r.anchor, sha256(lines.slice(r.lineStart, ownEnd).join('\n')));
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
 * M06 `update_section` — a convenience over `update_page`, not a second store.
 *
 * The brief is explicit that a section is not a structural gap in the data
 * model: this reads the whole page, splices the new text over the addressed
 * section's line range, and writes the whole page back with the SAME primitive.
 * Which is why the `expectedHash` it takes is the PAGE's hash — there is no
 * separate section version to be stale against, and inventing one would be the
 * second store the brief rules out.
 *
 * ## The heading is not replaceable through here, on purpose
 *
 * `section_index` stores a section as `[lineStart .. lineEnd]`, 1-based
 * inclusive, where `lineStart` IS the heading line and `lineEnd` is the last
 * line before the next sibling's `<!-- anchor -->` comment. This operation
 * replaces everything strictly BELOW the heading, for two reasons that point
 * the same way:
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
 * The section's own `<!-- anchor: … -->` comment sits ABOVE `lineStart` and is
 * likewise untouched, so the anchor survives the write and the caller can edit
 * the same section twice.
 *
 * ## The line range comes from the FILE, not from the index
 *
 * The index row is used to answer "which page, on which root" and for the
 * not-found refusal. The range that gets spliced is recomputed from the bytes
 * about to be written, with `parseHeadings` — the indexer's own parser — and the
 * indexer's own end rule.
 *
 * A first version trusted `row.lineStart`/`row.lineEnd` and only bounds-checked
 * them, which is a guard against the loud failure and none at all against the
 * quiet one. `section_index` is maintained by a watcher, so it trails the file
 * by however long a reaction takes, and any edit outside this operation — a
 * `git checkout`, a hand edit, an editor save still in flight — moves the
 * boundaries. When the file stays long enough for the stale range to remain in
 * bounds, the splice lands on whatever now occupies those lines: it eats the tail
 * of the previous section, or the heading and anchor comment of the next one, and
 * answers 200 with a fresh hash. The caller has no way to know, and the destroyed
 * anchor takes every reference to it down with it. `expectedHash` would catch it,
 * but it is optional in all three channels by deliberate decision, so it cannot be
 * the thing this rests on.
 *
 * Recomputing removes the failure class instead of detecting it, and costs one
 * pass over lines we have already read. If the anchor is not in the file at all,
 * the index is ahead of reality in the other direction and the write is refused.
 */
export async function updateSection(
  deps: SectionWriteDeps,
  input: UpdateSectionInput,
  actor: WriteActor,
): Promise<UpdateSectionResult> {
  if (!input.anchor) throw new DomainError('VALIDATION', 'anchor required');
  if (typeof input.content !== 'string') throw new DomainError('VALIDATION', 'content required');
  const section = deps.sections.getByAnchor(input.anchor);
  if (!section) {
    throw new DomainError(
      'SECTION_NOT_FOUND',
      `section '${input.anchor}' not found`,
      'list the anchors of a page with list_sections({ by: "page", rootId, path })',
    );
  }
  const target = deps.resolveRoot(section.rootId);
  if (!target) {
    throw new DomainError(
      'ROOT_NOT_FOUND',
      `section '${input.anchor}' is indexed on root '${section.rootId}', which is not mounted`,
    );
  }

  /**
   * Before the hash guard, because the hash guard cannot express this.
   *
   * `assertUnchanged` reads an unreadable file as "nothing to have changed
   * underneath you" — correct for `update_page`, which doubles as create — and
   * then this function reads the page unconditionally. So a caller who did
   * everything right, `expectedHash` included, sailed past the guard and hit a
   * raw ENOENT from `read()`, which is not a `DomainError` and therefore rendered
   * as `500 INTERNAL`: the server telling a client to retry the one situation
   * where retrying can never work. A section indexed on a page that is gone is a
   * stale index, and says so.
   */
  if (!(await target.pages.exists(section.pagePath))) {
    throw new DomainError(
      'SECTION_NOT_FOUND',
      `section '${input.anchor}' is indexed on '${section.pagePath}', which no longer exists`,
      'the section index is behind the filesystem — re-list the page with list_sections({ by: "page", rootId, path })',
    );
  }

  await assertUnchanged(target, section.pagePath, input.expectedHash);
  const page = await target.pages.read(section.pagePath);
  const lines = page.body.split('\n');

  // The index is built over the page BODY (frontmatter stripped), which is what
  // `read()` returns — so `parseHeadings` here sees the same lines the indexer
  // saw, and 1-based `lineStart` is `lineIndex + 1` on both sides.
  const range = liveRangeOf(lines, section.anchor);
  if (!range) {
    throw new ConflictError(
      'PAGE_CONFLICT',
      `anchor '${input.anchor}' is not in '${section.pagePath}' any more — the section index is behind the file`,
      (await hashOf(target.pages, section.pagePath)) ?? '',
    );
  }

  // Below the heading: 0-based [lineStart, lineEnd) — `lineStart - 1` is the
  // heading itself and stays put.
  lines.splice(range.lineStart, range.lineEnd - range.lineStart, ...input.content.split('\n'));

  const before = sectionDigests(page.body);
  const written = await commit(target, section.pagePath, actor, {
    body: lines.join('\n'),
    ...(Object.keys(page.frontmatter).length > 0 ? { frontmatter: page.frontmatter } : {}),
  });
  return {
    anchor: input.anchor,
    hash: written.hash,
    version: written.version,
    // The edited anchor is `anchor` above; repeating it in the list would be the
    // one thing in this answer the caller already knew.
    affectedAnchors: anchorDelta(before, written.digests).filter((a) => a !== input.anchor),
  };
}
