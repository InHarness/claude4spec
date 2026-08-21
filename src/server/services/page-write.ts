import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type { SelfWriteMarker, WriteActor } from '../fs/sources.js';
import type { FileVersionService } from './file-version.js';
import type { PagesService } from './pages.js';
import type { SectionsService } from './sections.js';
import { ConflictError } from './brief.js';
import { DomainError } from './tags.js';
import {
  applyTextEdits,
  type MatchPosition,
  type MatchRange,
  type PositionResolver,
  type TextEdit,
} from './text-edits.js';
/**
 * 0.2.43 — the section walk moved to `section-text.ts` so `plan-write.ts` runs
 * the SAME one. Nothing about the page path changed with it; these are the
 * identical functions, imported instead of declared.
 */
import {
  anchorDelta,
  anchorsInLineSpans,
  applySectionEdit,
  liveRangeOf,
  ownEndOf,
  sectionDigests,
  sectionRanges,
  sha256,
  subtreePositionResolver,
  type LineSpan,
} from './section-text.js';

export type { TextEdit } from './text-edits.js';

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
  /** Sets the frontmatter `title`. Ignored when `content` is supplied — that carries its own. */
  title?: string;
  content?: string;
}

/**
 * `update_page` takes its new content in exactly ONE of two ways, and 0.2.37's
 * hard rule is that it must be one and not the other:
 *
 *  - LITERAL — `body` (plus optional `frontmatter`): the complete new text.
 *  - DIFFERENTIAL — `textEdits`: a list of literal substitutions applied to the
 *    file as it stands.
 *
 * Both at once, or neither, is `INVALID_ARGUMENT`. Neither is not a no-op: a
 * write with no description of its new content is a call the caller got wrong,
 * and answering it with silence hides that.
 *
 * `expectedHash` is required in BOTH modes — see {@link assertUnchanged}.
 */
export interface UpdatePageInput {
  path: string;
  /** LITERAL mode. The complete markdown body, frontmatter excluded. */
  body?: string;
  /** LITERAL mode only — replaces the frontmatter wholesale. */
  frontmatter?: Record<string, unknown>;
  /**
   * DIFFERENTIAL mode. Substitutions are matched against the WHOLE FILE,
   * frontmatter and the preamble above the first heading included — which is
   * what makes this the only punctual write available when the target sits
   * outside every section, or on a root with no section index at all.
   */
  textEdits?: TextEdit[];
  /**
   * DIFFERENTIAL mode only — the anchors this call is allowed to destroy.
   *
   * Inherited from `update_sections`, deliberately: a `find` that swallows an
   * `<!-- anchor: … -->` comment breaks every citation of it just as thoroughly
   * as a `replace` over the same lines, so the same guard has to cover it. The
   * literal `body` mode has no such guard and never had one — it rewrites the
   * page wholesale, where "which anchors did you mean to keep" has no answer.
   */
  dropAnchors?: string[];
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
 *
 * 0.2.37 adds a fifth, and it is the one that does NOT fit the paragraph above:
 *
 *  - `edit`         — literal substitutions inside the subtree. NOT idempotent,
 *                     and the only action that takes `textEdits` instead of
 *                     `content`.
 *
 * The four whole-section actions are aimed at a SUBTREE; `edit` is aimed at the
 * FRAGMENTS its patterns match. That distinction is not cosmetic — it decides
 * which anchors an edit may be declared to drop and which ones trip
 * `ANCHOR_LOSS`, so it is carried all the way through `scopeOf` below.
 */
export type SectionEditAction = 'replace' | 'append' | 'insert_after' | 'delete' | 'edit';

export const SECTION_EDIT_ACTIONS: readonly SectionEditAction[] = [
  'replace',
  'append',
  'insert_after',
  'delete',
  'edit',
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
   * Required for `replace` / `append` / `insert_after`. Forbidden for `delete`,
   * which addresses a section and carries nothing, and for `edit`, which
   * describes its change in {@link SectionEdit.textEdits} instead.
   */
  content?: string;
  /**
   * `edit` only, and REQUIRED there — the literal substitutions to run inside
   * the addressed subtree.
   *
   * One `edit` item may carry N substitutions and perform all of them in a
   * single batch entry. That is the whole reason the field is a list: repeating
   * the same anchor to get a second substitution is not merely wasteful, it is
   * refused, because a duplicated anchor in one batch is ambiguous.
   *
   * Scope is the SUBTREE, not the page. Against `update_page`'s page-wide
   * differential mode this buys exactly two things — a shorter `find`, since it
   * needs no disambiguating context, and a narrower space to hit by accident.
   * Reach for the section scope when the target sits in one known section, and
   * for the page scope when it crosses sections or lies outside all of them.
   */
  textEdits?: TextEdit[];
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
  /**
   * DIFFERENTIAL mode only — how many substitutions landed.
   *
   * Absent from a literal write, where there is nothing to count. Under
   * `expectedMatches: "all"` it is the one thing in the answer the caller could
   * not have worked out for itself, which is exactly the echo-free rule's test
   * for what a write is allowed to report.
   */
  replacements?: number;
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
   *
   * For `edit` this is measured over the MATCHED FRAGMENTS rather than the
   * addressed subtree — a substitution destroys the identities its patterns
   * swallowed, not everything that happened to sit under the heading it aimed at.
   */
  droppedAnchors: string[];
  /** `edit` only — how many substitutions this entry performed. */
  replacements?: number;
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

/** `modules/m16-onboarding.md` → `m16-onboarding`. The last resort for a template's title. */
function titleFromPath(relPath: string): string {
  return path.basename(relPath).replace(/\.mdx?$/i, '');
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
  /**
   * An omitted `content` is NOT an empty page — the route generates a default
   * template. What that template guarantees is exactly one thing: a frontmatter
   * block carrying `title`. Everything past that (an H1, placeholder sections,
   * per-root variants) is deliberately not part of the contract, so nothing is
   * invented here — the body stays empty and `commit` serializes the frontmatter
   * through the same gray-matter path every other write uses.
   *
   * The consequence callers must know: a freshly created page's `content` is not
   * `''`, and its hash is the hash of the template. To get a genuinely empty
   * page, overwrite it right after creating it.
   *
   * `title` falls back to the file's basename because a page whose frontmatter
   * says `title: ''` is worse than one named after itself.
   */
  const written =
    input.content !== undefined
      ? await commit(target, relPath, actor, { body: input.content })
      : await commit(target, relPath, actor, {
          body: '',
          frontmatter: { title: input.title?.trim() || titleFromPath(relPath) },
        });
  return { rootId: target.pages.rootId, path: relPath, hash: written.hash, anchors: written.anchors };
}

/**
 * What the DIFFERENTIAL branch of `update_page` needs and the literal one does
 * not: a way to find out who cites an anchor, and whether this root has a
 * section index at all.
 *
 * A separate, optional parameter rather than fields on {@link PageWriteTarget}
 * because `update_page` has always been answerable with nothing but a target —
 * the hand-rolled test rigs and `create_page`/`delete_page` still are — and the
 * guard is only reachable on the one branch that can trip it. Structurally a
 * superset of `SectionWriteDeps` minus `resolveRoot`, so a caller that already
 * built one passes `{ ...sectionWriteDeps, sectionIndexed }`.
 */
export interface PageDiffDeps {
  /** For the heading text in an `ANCHOR_LOSS` report. Absent → the anchor alone. */
  sections?: SectionsService;
  /** See {@link SectionWriteDeps.findSectionReferents}. Absent → report-only, cannot refuse. */
  findSectionReferents?: (anchor: string) => Promise<SectionReferent[]>;
  /**
   * The addressed root's `sectionIndexed` flag.
   *
   * `false` skips the guard OUTRIGHT — not "runs it and finds nothing". Without
   * a section index there is no set of anchors to measure a loss against, so
   * `dropAnchors` is a parameter with no meaning on such a root, and a guard
   * that cannot see anything must not pretend it looked.
   */
  sectionIndexed?: boolean;
}

export async function updatePage(
  target: PageWriteTarget,
  input: UpdatePageInput,
  actor: WriteActor,
  diffDeps?: PageDiffDeps,
): Promise<UpdatePageResult> {
  const relPath = input.path;
  if (!relPath) throw new DomainError('VALIDATION', 'path required');

  /**
   * The disjunction, checked before anything else touches the disk.
   *
   * "Neither" is refused rather than treated as an empty write: a call that
   * describes no new content is a caller mistake, and the shape of the mistake
   * (forgot the payload / sent the wrong field name) is invisible from a
   * successful no-op.
   */
  const hasBody = typeof input.body === 'string';
  const hasEdits = input.textEdits !== undefined;
  if (hasBody && hasEdits) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'body and textEdits are mutually exclusive — exactly one describes the new content',
      'send `body` to replace the page wholesale, or `textEdits` to substitute fragments of it',
    );
  }
  if (!hasBody && !hasEdits) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'one of body or textEdits is required',
      'send `body` (the complete new markdown) or `textEdits` (literal find/replaceWith substitutions)',
    );
  }
  if (hasEdits && input.frontmatter !== undefined) {
    /**
     * `frontmatter` belongs to the literal mode. Accepting it here and quietly
     * dropping it would be the failure `update_sections` refuses by name a few
     * hundred lines down: a caller who sent a field believes it did something.
     * The differential mode CAN reach frontmatter — by matching its text, which
     * is the whole point of substituting over the full file.
     */
    throw new DomainError(
      'INVALID_ARGUMENT',
      'frontmatter belongs to a literal write',
      'substitute the frontmatter text with a `textEdits` entry, or send `body` + `frontmatter` instead',
    );
  }
  if (hasBody && input.dropAnchors !== undefined) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'dropAnchors applies to textEdits only',
      'a whole-page `body` write has no anchor-loss guard to override',
    );
  }

  // The guard runs identically on both branches — see `assertUnchanged`.
  await assertUnchanged(target, relPath, input.expectedHash);

  // Read BEFORE writing: the delta is against what was on disk, and this doubles
  // as create-or-replace, so "no page yet" means every anchor is an addition.
  const before = sectionDigests(await bodyOnDisk(target.pages, relPath));

  if (hasEdits) {
    return await updatePageByTextEdits(target, relPath, input, actor, before, diffDeps);
  }

  const written = await commit(target, relPath, actor, {
    body: input.body as string,
    ...(input.frontmatter !== undefined ? { frontmatter: input.frontmatter } : {}),
  });
  return {
    hash: written.hash,
    version: written.version,
    changedAnchors: anchorDelta(before, written.digests),
  };
}

/**
 * The differential branch.
 *
 * Substitution runs over the FULL FILE — frontmatter, the preamble above the
 * first heading, everything — and not over the body the section machinery works
 * in. That is the branch's reason for existing: it is the only punctual write
 * that can reach text no anchor addresses.
 *
 * The write itself still goes through `commit` with a body and frontmatter,
 * because `PagesService.write` is the one door onto disk and re-serializing
 * through gray-matter is what keeps the caller's next `expectedHash` honest.
 */
async function updatePageByTextEdits(
  target: PageWriteTarget,
  relPath: string,
  input: UpdatePageInput,
  actor: WriteActor,
  before: Map<string, string>,
  diffDeps: PageDiffDeps | undefined,
): Promise<UpdatePageResult> {
  const fullBefore = await fileOnDisk(target.pages, relPath);
  const bodyBefore = matter(fullBefore).content;
  const applied = applyTextEdits(fullBefore, input.textEdits ?? [], pagePositionResolver(fullBefore));
  /**
   * Substitution is blind to the frontmatter fence it may have just written
   * through, so a `replaceWith` can leave YAML that does not parse. That is a
   * deterministic mistake in the request — the same class as `FIND_NOT_FOUND` —
   * and answering `500 INTERNAL` would tell the caller to retry a call that can
   * only fail again. The file is untouched either way: this precedes `commit`.
   */
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(applied.text);
  } catch (err) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `the substituted text no longer parses as a markdown page: ${(err as Error).message}`,
      'your textEdits rewrote the YAML frontmatter into something invalid — check quoting and indentation in `replaceWith`',
    );
  }

  /**
   * The guard, on the same terms `update_sections` states them — and BEFORE the
   * write, so a refusal leaves the file byte-identical.
   *
   * Skipped whole on a root with no section index: `sectionIndexed === false`
   * means there are no anchors recorded to lose. An ABSENT flag is treated as
   * "indexed", because the rigs that pass no deps at all also pass no referent
   * lookup, and the guard below then degrades to report-only on its own.
   */
  if (diffDeps?.sectionIndexed !== false) {
    await assertNoUndeclaredAnchorLoss({
      linesBefore: bodyBefore.split('\n'),
      linesAfter: parsed.content.split('\n'),
      touchedSpans: bodyLineSpans(fullBefore, bodyBefore, applied.matchRanges),
      declared: input.dropAnchors ?? [],
      deps: diffDeps,
      strangerHint: 'dropAnchors may only name anchors inside the fragments your textEdits match',
    });
  }

  const written = await commit(target, relPath, actor, {
    body: parsed.content,
    ...(Object.keys(parsed.data).length > 0 ? { frontmatter: parsed.data } : {}),
  });
  return {
    hash: written.hash,
    version: written.version,
    changedAnchors: anchorDelta(before, written.digests),
    replacements: applied.replacements,
  };
}

/** A page's full bytes as they currently stand, or empty when it is not there yet. */
async function fileOnDisk(pages: PagesService, relPath: string): Promise<string> {
  try {
    return await fs.readFile(path.join(pages.root, relPath), 'utf-8');
  } catch {
    return '';
  }
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
 * Which lines a set of character spans covers, translated from the FULL FILE's
 * offsets into the BODY's line numbering.
 *
 * The translation exists because the two halves of a differential write live in
 * different coordinate systems on purpose: substitution is deliberately blind to
 * frontmatter boundaries (that is what lets it reach the preamble), while every
 * anchor question is asked in body lines, the only place headings exist. A span
 * that lands entirely inside the frontmatter simply covers no body line.
 */
function bodyLineSpans(fullText: string, bodyText: string, ranges: readonly MatchRange[]): LineSpan[] {
  const bodyStart = fullText.length - bodyText.length;
  const lineAt = (offset: number) => fullText.slice(0, offset).split('\n').length - 1;
  const bodyFirstLine = lineAt(bodyStart);
  return ranges.map((r) => ({
    from: lineAt(r.start) - bodyFirstLine,
    to: lineAt(r.end) - bodyFirstLine,
  }));
}

/**
 * The `ANCHOR_LOSS` guard as `update_page`'s differential branch needs it.
 *
 * Deliberately the same three decisions `updateSections` makes inline — dropped
 * is decided BY THE INDEX (absent from the after-state, not "the text changed"),
 * a declared anchor outside every touched span is a stranger and refused, and an
 * undeclared drop only refuses when something actually cites it. Two guards that
 * merely resembled each other would be the drift this release is not here to
 * add; the section path keeps its inline version because it has per-edit
 * attribution to preserve, which this branch has no equivalent of.
 */
async function assertNoUndeclaredAnchorLoss(args: {
  linesBefore: string[];
  linesAfter: string[];
  touchedSpans: readonly LineSpan[];
  declared: readonly string[];
  deps: PageDiffDeps | undefined;
  strangerHint: string;
}): Promise<void> {
  const scope = anchorsInLineSpans(args.linesBefore, args.touchedSpans);
  const onPage = new Set(sectionRanges(args.linesBefore).map((r) => r.anchor));
  const inScope = new Set(scope);

  const stranger = args.declared.find((a) => onPage.has(a) && !inScope.has(a));
  if (stranger !== undefined) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `dropAnchors names '${stranger}', which none of this write's matched fragments contains`,
      args.strangerHint,
    );
  }

  const survivors = new Set(sectionRanges(args.linesAfter).map((r) => r.anchor));
  const declared = new Set(args.declared);
  const undeclared = scope.filter((a) => !survivors.has(a) && !declared.has(a));
  if (undeclared.length === 0 || !args.deps?.findSectionReferents) return;

  const losses: AnchorLoss[] = [];
  for (const anchor of undeclared) {
    const referencedBy = await args.deps.findSectionReferents(anchor);
    if (referencedBy.length === 0) continue;
    losses.push({
      anchor,
      headingText: args.deps.sections?.getByAnchor(anchor)?.headingText ?? '',
      referencedBy,
    });
  }
  if (losses.length > 0) throw new AnchorLossError(losses);
}

/**
 * Positions for a `MATCH_COUNT_MISMATCH` on a whole page: anchor plus line,
 * never a byte offset.
 *
 * An offset is not a place a caller can go and look, and the answer exists so
 * they CAN look — they are being told their pattern hit somewhere they did not
 * expect. The innermost containing section wins, since the deepest heading is
 * the one that actually names the text; a hit above the first heading (or inside
 * the frontmatter) honestly reports no anchor rather than borrowing the page's.
 */
function pagePositionResolver(fullText: string): PositionResolver {
  const bodyText = matter(fullText).content;
  const bodyFirstLine = fullText.slice(0, fullText.length - bodyText.length).split('\n').length - 1;
  const ranges = sectionRanges(bodyText.split('\n'));
  return (offset): MatchPosition => {
    const fullLine = fullText.slice(0, offset).split('\n').length - 1;
    const bodyLine = fullLine - bodyFirstLine;
    const containing = ranges.filter((r) => bodyLine >= r.lineStart - 1 && bodyLine < r.lineEnd);
    const innermost = containing.reduce<{ anchor: string; lineStart: number } | null>(
      (best, r) => (best === null || r.lineStart > best.lineStart ? r : best),
      null,
    );
    return { anchor: innermost?.anchor ?? null, line: fullLine + 1 };
  };
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
    /**
     * The action decides WHICH field describes the change, and 0.2.37 makes the
     * mapping exhaustive in both directions. Sending the other field is refused
     * rather than ignored: a caller who sent `content` to an `edit` believes it
     * did something, and a silent drop is how it finds out much later that it
     * did not.
     */
    if (edit.action === 'edit') {
      if (edit.content !== undefined) {
        throw new DomainError(
          'INVALID_ARGUMENT',
          `edit for '${edit.anchor}' takes textEdits, not content — action 'edit' substitutes fragments, it does not replace the section`,
        );
      }
      if (!Array.isArray(edit.textEdits) || edit.textEdits.length === 0) {
        throw new DomainError(
          'INVALID_ARGUMENT',
          `edit for '${edit.anchor}' requires a non-empty textEdits for action 'edit'`,
          'each entry is { find, replaceWith, expectedMatches? }',
        );
      }
    } else {
      if (edit.textEdits !== undefined) {
        throw new DomainError(
          'INVALID_ARGUMENT',
          `edit for '${edit.anchor}' carries textEdits, which only action 'edit' accepts`,
          `action '${edit.action}' describes its new content in \`content\``,
        );
      }
      if (edit.action !== 'delete' && typeof edit.content !== 'string') {
        throw new DomainError('VALIDATION', `edit for '${edit.anchor}' requires content for action '${edit.action}'`);
      }
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
  /**
   * An `edit` that NESTS with another entry — either direction — is refused, and
   * only `edit` is: the bottom-up walk already makes `replace`-inside-`replace`
   * well defined, because a whole-section action states its result outright and
   * the outer one simply wins.
   *
   * A substitution states a CHANGE instead, and both directions break it. With
   * the `edit` inside, an outer entry overwrites the same lines and the caller
   * has no answer to "did my substitution survive?" — and a `replacements` count
   * reporting work that was then thrown away. With the `edit` outside, the inner
   * entry splices FIRST, so the `find` would be matched against text this same
   * batch just wrote: a pattern that never existed in the page the caller read
   * could match, and one that did could vanish into `FIND_NOT_FOUND`. Either way
   * the order of the batch would start to matter, which is exactly what
   * `applyTextEdits` promises it never does.
   */
  const rangeByAnchor = new Map(sectionRanges(lines).map((r) => [r.anchor, r]));
  for (const { edit } of located) {
    if (edit.action !== 'edit') continue;
    const mine = rangeByAnchor.get(edit.anchor)!;
    const clash = located.find(({ edit: other }) => {
      if (other.anchor === edit.anchor) return false;
      const theirs = rangeByAnchor.get(other.anchor);
      if (!theirs) return false;
      const insideThem = theirs.lineStart < mine.lineStart && theirs.lineEnd >= mine.lineEnd;
      const aroundThem = mine.lineStart < theirs.lineStart && mine.lineEnd >= theirs.lineEnd;
      return insideThem || aroundThem;
    });
    if (clash) {
      const theirs = rangeByAnchor.get(clash.edit.anchor)!;
      const relation = theirs.lineStart < mine.lineStart ? 'lies inside' : 'encloses';
      throw new DomainError(
        'INVALID_ARGUMENT',
        `edit on '${edit.anchor}' ${relation} the section '${clash.edit.anchor}' that another entry in this batch ${clash.edit.action}s`,
        'split them into separate calls, or fold the substitution into the outer entry\'s content',
      );
    }
  }

  const scopeOf = new Map<string, string[]>();
  const replacementsOf = new Map<string, number>();
  for (const { edit } of order) {
    const range = liveRangeOf(lines, edit.anchor);
    if (!range) {
      throw new ConflictError(
        'PAGE_CONFLICT',
        `anchor '${edit.anchor}' was removed by an earlier edit in the same batch`,
        currentHash,
      );
    }
    if (edit.action === 'edit') {
      /**
       * The subtree, heading line excluded — the same span `replace` overwrites,
       * so an `edit` can no more swallow its own anchor comment than a `replace`
       * can. Descendants' anchors are inside it and ARE at risk, which is what
       * the scope below is measured for.
       */
      const subtreeText = lines.slice(range.lineStart, range.lineEnd).join('\n');
      const applied = applyTextEdits(subtreeText, edit.textEdits ?? [], subtreePositionResolver(edit.anchor));
      replacementsOf.set(edit.anchor, applied.replacements);
      /**
       * Scope from the MATCHED FRAGMENTS, not from the addressed subtree — the
       * one place `edit` parts company with the other four actions. A
       * substitution three headings down destroys nothing above it, so naming
       * those anchors in `dropAnchors` would be declaring a loss this entry
       * cannot cause.
       */
      const lineAt = (o: number) => subtreeText.slice(0, o).split('\n').length - 1;
      const spans = applied.matchRanges.map((r) => ({
        from: range.lineStart + lineAt(r.start),
        to: range.lineStart + lineAt(r.end),
      }));
      scopeOf.set(edit.anchor, anchorsInLineSpans(lines, spans));
      lines.splice(range.lineStart, range.lineEnd - range.lineStart, ...applied.text.split('\n'));
      continue;
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
      // Only `edit` has a count; the other four rows stay the shape they were.
      ...(edit.action === 'edit' ? { replacements: replacementsOf.get(edit.anchor) ?? 0 } : {}),
    })),
  };
}
