import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PageContent } from '../../shared/types.js';
import type { SelfWriteMarker, WriteActor } from '../fs/sources.js';
import type { PagesService } from './pages.js';
import type { SectionsService } from './sections.js';
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

  await assertUnchanged(target, section.pagePath, input.expectedHash);
  const page = await target.pages.read(section.pagePath);
  const lines = page.body.split('\n');

  /**
   * The index is built over the page BODY (frontmatter stripped), which is what
   * `read()` returns — so the 1-based line numbers map onto this array
   * directly. A range that no longer fits the file means the index is behind
   * the bytes; splicing anyway would overwrite whatever now occupies those
   * lines, so it is refused as the staleness it is. A caller who passed
   * `expectedHash` never gets here — that guard fires first, with a better
   * message.
   */
  if (section.lineStart < 1 || section.lineEnd > lines.length || section.lineEnd < section.lineStart) {
    throw new ConflictError(
      'PAGE_CONFLICT',
      `section '${input.anchor}' spans lines ${section.lineStart}-${section.lineEnd}, but '${section.pagePath}' has ${lines.length} — the section index is behind the file`,
      (await hashOf(target.pages, section.pagePath)) ?? '',
    );
  }

  // Below the heading: 0-based [lineStart, lineEnd) — `lineStart - 1` is the
  // heading itself and stays put.
  lines.splice(section.lineStart, section.lineEnd - section.lineStart, ...input.content.split('\n'));

  const written = await commit(target, section.pagePath, actor, {
    body: lines.join('\n'),
    ...(Object.keys(page.frontmatter).length > 0 ? { frontmatter: page.frontmatter } : {}),
  });
  return { ...written, anchor: input.anchor, rootId: section.rootId, pagePath: section.pagePath };
}
