import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PageContent } from '../../shared/types.js';
import type { SelfWriteMarker, WriteActor } from '../fs/sources.js';
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
 * against the brief.
 */

/** Everything a page write needs about the root it targets. */
export interface PageWriteTarget {
  pages: PagesService;
  /** Null only in the hand-rolled test rigs; a mounted root always has one. */
  writer: SelfWriteMarker | null;
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

/** What every write answers with: the page, plus the hash of what actually landed. */
export type PageWriteResult = PageContent & { hash: string };

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
): Promise<PageWriteResult> {
  target.writer?.markOrigin(relPath, actor);
  const result = await target.pages.write(relPath, input);
  await target.writer?.flush(relPath);
  const written = await fs.readFile(path.join(target.pages.root, relPath), 'utf-8');
  return { ...result, hash: sha256(written) };
}

export async function createPage(
  target: PageWriteTarget,
  input: CreatePageInput,
  actor: WriteActor,
): Promise<PageWriteResult> {
  const relPath = input.path;
  if (!relPath) throw new DomainError('VALIDATION', 'path required');
  if (await target.pages.exists(relPath)) {
    throw new DomainError(
      'PAGE_EXISTS',
      `page '${relPath}' already exists`,
      `update it with update_page({ rootId: "${target.pages.rootId}", path: "${relPath}", body }) instead`,
    );
  }
  return commit(target, relPath, actor, { body: input.content ?? '' });
}

export async function updatePage(
  target: PageWriteTarget,
  input: UpdatePageInput,
  actor: WriteActor,
): Promise<PageWriteResult> {
  const relPath = input.path;
  if (!relPath) throw new DomainError('VALIDATION', 'path required');
  if (typeof input.body !== 'string') throw new DomainError('VALIDATION', 'body required');
  await assertUnchanged(target, relPath, input.expectedHash);
  return commit(target, relPath, actor, {
    body: input.body,
    ...(input.frontmatter !== undefined ? { frontmatter: input.frontmatter } : {}),
  });
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
  const headings = parseHeadings(lines);
  const idx = headings.findIndex((h) => h.anchor === anchor);
  if (idx === -1) return null;
  const self = headings[idx]!;
  let lineEnd = lines.length;
  for (let j = idx + 1; j < headings.length; j++) {
    const next = headings[j]!;
    if (next.level <= self.level) {
      lineEnd = next.anchorLineIndex ?? next.lineIndex;
      break;
    }
  }
  return { lineStart: self.lineIndex + 1, lineEnd };
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
): Promise<PageWriteResult & { anchor: string; rootId: string; pagePath: string }> {
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

  const written = await commit(target, section.pagePath, actor, {
    body: lines.join('\n'),
    ...(Object.keys(page.frontmatter).length > 0 ? { frontmatter: page.frontmatter } : {}),
  });
  return { ...written, anchor: input.anchor, rootId: section.rootId, pagePath: section.pagePath };
}
