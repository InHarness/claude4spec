/**
 * 0.2.40 — the artifact READ family: one window, one degradation marker, one
 * error taxonomy, for all three artifact kinds (brief, patch, plan).
 *
 * Why this module exists rather than three near-copies: the family's four
 * positions (`list_<kind>s`, `get_<kind>` with a window, `search_<kind>s`, the
 * response budget) are a contract about the KIND, not about the mechanism. A
 * kind declares what it answers for each position; it does not get to invent its
 * own variant of the codes or its own shape of window. An asymmetry between
 * kinds is a specification error exactly when it is UNWRITTEN — so `n/a` with a
 * reason is a legal, sufficient answer, and silence is not.
 *
 * The one substantive difference from `get_page`'s window: there is NO
 * `sectionIndexed` gate here, and there cannot be one. On pages the core has two
 * ways to resume a read, chosen by the root: an indexed root resumes through
 * `list_sections` + `get_sections`, a non-indexed one through `range`. Artifacts
 * NEVER enter `section_index` (every `artifactRegistry` entry is
 * `sectionIndexed: false`), so only `range` exists — which makes `range`
 * unconditionally allowed and `truncationHint` unconditionally point at it,
 * where `get_page` has to branch.
 */

import { DEFAULT_BUDGET_CHARS, truncateText } from '../discovery/budget.js';
import { artifactRegistry, type ArtifactKind } from './artifact-registry.js';
import { DomainError } from './tags.js';

/** A 1-based inclusive line window — deliberately the same shape as `get_page.range`. */
export interface ArtifactRange {
  start: number;
  end: number;
}

export interface ArtifactWindowResult {
  content: string;
  truncated?: true;
  truncationHint?: string;
}

/**
 * The family's shared error codes.
 *
 * `IMMUTABLE_FIELD` is listed here even though this module never throws it: it
 * is the family's code, owned by the family, and the point of the list is that
 * no kind may answer a family concern with a code of its own invention. A
 * reader looking for "what does a brief throw that a plan does not" should find
 * the answer to be "nothing, for these".
 */
export const ARTIFACT_FAMILY_ERROR_CODES = ['IMMUTABLE_FIELD', 'INVALID_ARGUMENT'] as const;

/**
 * Apply a line window to an artifact's raw content.
 *
 * A range past the end of the file is REFUSED, and the refusal states the file's
 * size. `Array.prototype.slice` would clamp it to an empty string and answer 200
 * instead — which reads, to the caller, exactly like a window over blank lines.
 * A caller that cannot tell "you asked past the end" from "there is nothing
 * here" has no way to correct itself, and the size is the one number that makes
 * the next call obvious.
 */
export function applyArtifactRange(
  content: string,
  range: ArtifactRange | undefined,
  ctx: { kind: ArtifactKind; path: string },
): string {
  if (!range) return content;
  const { start, end } = range;
  const lines = content.split('\n');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `invalid range { start: ${String(start)}, end: ${String(end)} } for ${ctx.kind} '${ctx.path}'`,
      'range is 1-based and inclusive: { start: 1, end: 200 }',
    );
  }
  if (start > lines.length) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `range starts at line ${start} but ${ctx.kind} '${ctx.path}' has ${lines.length} lines`,
      `read the tail with range: { start: ${Math.max(lines.length - 199, 1)}, end: ${lines.length} }`,
    );
  }
  return lines.slice(start - 1, end).join('\n');
}

/**
 * Apply the response budget to an artifact's content.
 *
 * The hint is UNCONDITIONAL, unlike `get_page`'s: an artifact has exactly one
 * way to be resumed, so there is no branch to get wrong and no possibility of
 * proposing a call this operation would refuse.
 */
export function budgetArtifactContent(
  content: string,
  ctx: { kind: ArtifactKind; path: string },
  budgetChars = DEFAULT_BUDGET_CHARS,
): ArtifactWindowResult {
  const lineCount = content.split('\n').length;
  const budgeted = truncateText(
    content,
    `${ctx.kind} '${ctx.path}' was truncated by the response budget — read it in windows with ` +
      `range: { start: 1, end: 400 } and advance (the file has ${lineCount} lines).`,
    budgetChars,
  );
  if (!budgeted.truncated) return { content: budgeted.text };
  return { content: budgeted.text, truncated: true, truncationHint: budgeted.truncationHint };
}

/**
 * Window + budget in the order they must happen: narrow first, then measure.
 *
 * Reversed, a caller asking for a small window of a huge file would be told its
 * window was truncated when it was not.
 */
export function readArtifactWindow(
  content: string,
  range: ArtifactRange | undefined,
  ctx: { kind: ArtifactKind; path: string },
  budgetChars = DEFAULT_BUDGET_CHARS,
): ArtifactWindowResult {
  return budgetArtifactContent(applyArtifactRange(content, range, ctx), ctx, budgetChars);
}

/** Every kind in the registry answers this — `n/a` with a reason included. */
export function artifactReadFamily(kind: ArtifactKind): (typeof artifactRegistry)[ArtifactKind]['readFamily'] {
  return artifactRegistry[kind].readFamily;
}
