import { DomainError } from './tags.js';
import { parseHeadings } from './section-indexer.js';
import {
  anchorsInLineSpans,
  applySectionEdit,
  liveRangeOf,
  sectionRanges,
  subtreePositionResolver,
} from './section-text.js';
import { applyTextEdits, type TextEdit } from './text-edits.js';

/**
 * 0.2.43 M10 — the plan's edit grammar, as three mutually exclusive input
 * variants instead of one action dictionary.
 *
 * ## What changed and why
 *
 * `update_plan` used to take `action: replace | append | insert_after_section`
 * plus one `content`. An agent iterating on a plan could therefore only rewrite
 * the whole file — expensive, and it silently overwrote whatever another thread
 * had written since the read — or bolt a fragment on after a section, which
 * could neither delete nor substitute anything in place.
 *
 * The replacement is deliberately the SAME grammar the page tools already speak
 * (`update_page` / `update_sections`), so an agent learns one way to describe an
 * edit rather than two:
 *
 *   - `content`   — the whole plan, literally (`update_page({ content })`)
 *   - `textEdits` — literal substitutions over the whole plan (`update_page({ textEdits })`)
 *   - `edits[]`   — a transactional section batch (`update_sections({ edits })`)
 *
 * ## What is NOT here
 *
 * The write tail — hash guard, file write, `file_version` capture, anchor
 * injection, the `plan:updated` broadcast — stays in `PlanService`. Everything
 * in this module is pure text, which is what makes the batch testable without a
 * filesystem and what keeps "one function per operation" true: `PlanService`
 * calls this, no channel does.
 *
 * There is also no `ANCHOR_LOSS` guard and no `dropAnchors`, unlike the page
 * batch. A page anchor can be cited from another page and the guard resolves
 * those citations through `section_index`; a plan anchor is unique within its
 * own file, is not indexed, and nothing cites it. A guard with no possible
 * referent would be ceremony.
 */

/**
 * The five section actions, identical to `update_sections`'.
 *
 * Note `insert_after`, not the plan's old `insert_after_section`: the name is
 * now the page's, because the behaviour is.
 */
export type PlanEditAction = 'replace' | 'append' | 'insert_after' | 'delete' | 'edit';

export const PLAN_EDIT_ACTIONS: readonly PlanEditAction[] = [
  'replace',
  'append',
  'insert_after',
  'delete',
  'edit',
];

export interface PlanSectionEdit {
  /**
   * The ONLY way to address a section of a plan. `heading` is gone as of
   * 0.2.43 — matching a section by the text of its heading made the address of
   * an edit depend on prose the same edit might be rewriting. Anchors come from
   * `get_plan`.
   */
  anchor: string;
  action: PlanEditAction;
  /** Required for `replace`/`append`/`insert_after`, forbidden for `delete` and `edit`. */
  content?: string;
  /** Required for `edit`, forbidden for the other four. */
  textEdits?: TextEdit[];
}

/** One row of the response's `results[]` — the same shape `update_sections` answers with. */
export interface PlanEditResult {
  /** `null` for the two whole-plan variants, which address no section. */
  anchor: string | null;
  /**
   * `null` for the two whole-plan variants, in parity with `anchor`.
   *
   * The five actions are defined for BATCH ENTRIES; `content` and `textEdits`
   * are input variants, not section actions, and none of the five describes
   * them. Naming one anyway would report a section action that never ran, and
   * dropping the key would break the uniform row shape the release is for — so
   * the row keeps every field and says "no section, no section action". The
   * specification does not settle this; filed as a clarification patch.
   */
  action: PlanEditAction | null;
  affectedAnchors: string[];
  droppedAnchors: string[];
  /** Only where a literal match ran: `edit`, and the top-level `textEdits`. */
  replacements?: number;
}

/** The one variant a call carries, after {@link selectPlanVariant} has settled which. */
export type PlanEditPayload =
  | { variant: 'content'; content: string }
  | { variant: 'textEdits'; textEdits: TextEdit[] }
  | { variant: 'edits'; edits: PlanSectionEdit[] };

export interface PlanVariantInput {
  content?: string;
  textEdits?: TextEdit[];
  edits?: PlanSectionEdit[];
}

/**
 * Which of the three variants this call is — and the refusal when it is not
 * exactly one.
 *
 * Runs BEFORE anything touches the plan file, which is the whole point: a
 * malformed request must not be able to create a plan, bump a version, or leave
 * a half-applied batch behind. Every refusal here is `INVALID_ARGUMENT`, because
 * every one of them is deterministic — re-reading the plan changes no answer,
 * the repair is in the request.
 */
export function selectPlanVariant(input: PlanVariantInput): PlanEditPayload {
  const present = [
    input.content !== undefined ? 'content' : null,
    input.textEdits !== undefined ? 'textEdits' : null,
    input.edits !== undefined ? 'edits' : null,
  ].filter((v): v is string => v !== null);

  if (present.length === 0) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'update_plan needs exactly one of `content`, `textEdits` or `edits` — it got none',
      'pass `content` for the whole plan, `textEdits` for literal substitutions over it, or `edits` for a section batch',
    );
  }
  if (present.length > 1) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `update_plan takes exactly one input variant, but got ${present.join(' and ')}`,
      'split the call: one variant describes the whole change, and combining two makes the result depend on an order you did not choose',
    );
  }

  if (input.content !== undefined) return { variant: 'content', content: input.content };
  if (input.textEdits !== undefined) return { variant: 'textEdits', textEdits: input.textEdits };
  return { variant: 'edits', edits: validateBatch(input.edits ?? []) };
}

/**
 * The batch's shape, checked in full before a single anchor is resolved.
 *
 * Order matters between these checks only in what a caller sees first; each one
 * is a refusal the file never has to be read to make.
 */
function validateBatch(edits: PlanSectionEdit[]): PlanSectionEdit[] {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'edits must be a non-empty array',
      'an empty batch describes no change; omit the call instead',
    );
  }
  const seen = new Set<string>();
  for (const edit of edits) {
    if (typeof edit?.anchor !== 'string' || edit.anchor.length === 0) {
      throw new DomainError('INVALID_ARGUMENT', 'each edit requires an `anchor`', 'anchors come from get_plan');
    }
    if (!PLAN_EDIT_ACTIONS.includes(edit.action)) {
      throw new DomainError(
        'INVALID_ARGUMENT',
        `unknown action '${edit.action}' — expected one of ${PLAN_EDIT_ACTIONS.join(' | ')}`,
      );
    }
    /**
     * The action decides WHICH field describes the change, and the mapping is
     * exhaustive in both directions. Sending the other field is refused rather
     * than ignored: a caller who sent `content` to an `edit` believes it did
     * something, and a silent drop is how it finds out much later that it did
     * not.
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
      if (edit.action === 'delete') {
        if (edit.content !== undefined) {
          throw new DomainError(
            'INVALID_ARGUMENT',
            `edit for '${edit.anchor}' carries content, which action 'delete' does not take`,
            'a delete addresses a section and carries nothing',
          );
        }
      } else if (typeof edit.content !== 'string') {
        throw new DomainError(
          'INVALID_ARGUMENT',
          `edit for '${edit.anchor}' requires content for action '${edit.action}'`,
        );
      }
    }
    /**
     * Two edits to one anchor in one batch is refused rather than folded.
     * Bottom-up application makes their combined effect depend on an ordering
     * the caller did not choose, and there is no reading of "replace it, then
     * append to it" that is not the caller having meant one call. An `edit`
     * carries a LIST of substitutions precisely so a second entry is never the
     * way to ask for a second one.
     */
    if (seen.has(edit.anchor)) {
      throw new DomainError(
        'INVALID_ARGUMENT',
        `anchor '${edit.anchor}' appears more than once in edits`,
        'one entry per section; an `edit` entry may carry several substitutions',
      );
    }
    seen.add(edit.anchor);
  }
  return edits;
}

export interface PlanBatchOutcome {
  /** The plan body after every edit has been spliced, in memory. */
  body: string;
  /** Per addressed anchor, the anchors that edit's range covered (before the splice). */
  scopeOf: Map<string, string[]>;
  /** Per addressed anchor of an `edit`, how many substitutions it made. */
  replacementsOf: Map<string, number>;
}

/**
 * Apply a whole batch to one plan body — in memory, all of it or none of it.
 *
 * ## Transactional, and the caller is what makes it so
 *
 * Nothing here writes. A refusal throws before returning, so `PlanService` never
 * reaches its write tail: no file change, no `file_version` row, no
 * `plan:updated`. That is the atomicity the release promises, and it is a
 * property of the batch being composed in a string rather than of a rollback.
 *
 * ## Bottom-up, whatever order the caller sent
 *
 * Entries are applied from the bottom of the document upwards, so an earlier
 * splice never moves the lines a later one addresses. Two different orderings of
 * the same batch therefore produce identical text: the caller declares a SET of
 * changes, never a procedure. (`results[]` still comes back in the order given —
 * that is the caller's frame, not the engine's.)
 */
export function applyPlanBatch(body: string, edits: readonly PlanSectionEdit[]): PlanBatchOutcome {
  const lines = body.split('\n');

  /**
   * A duplicate anchor inside the plan file itself is a defect to fix in the
   * plan, not a target to guess at. `sectionRanges` settles duplicates by first
   * occurrence (it must, to agree with every other reader), so the ambiguity has
   * to be detected here or it would be silently resolved in the caller's favour.
   */
  const occurrences = new Map<string, number>();
  for (const h of parseHeadings(lines)) {
    if (h.anchor) occurrences.set(h.anchor, (occurrences.get(h.anchor) ?? 0) + 1);
  }

  const rangeByAnchor = new Map(sectionRanges(lines).map((r) => [r.anchor, r]));
  for (const edit of edits) {
    if ((occurrences.get(edit.anchor) ?? 0) > 1) {
      throw new DomainError(
        'AMBIGUOUS_ANCHOR',
        `anchor '${edit.anchor}' matches ${occurrences.get(edit.anchor)} sections of this plan`,
        'an anchor names exactly one section — remove the duplicate from the plan',
      );
    }
    if (!rangeByAnchor.has(edit.anchor)) {
      throw new DomainError(
        'SECTION_NOT_FOUND',
        `section '${edit.anchor}' not found in this plan`,
        'read the plan with get_plan and take the anchor from an `<!-- anchor: … -->` comment',
      );
    }
  }

  /**
   * An `edit` that NESTS with another entry — either direction — is refused, and
   * only `edit` is: the bottom-up walk already makes `replace`-inside-`replace`
   * well defined, because a whole-section action states its result outright and
   * the outer one simply wins.
   *
   * A substitution states a CHANGE instead, and both directions break it. With
   * the `edit` inside, an outer entry overwrites the same lines and the caller
   * has no answer to "did my substitution survive?". With the `edit` outside,
   * the inner entry splices first, so the `find` would be matched against text
   * this same batch just wrote. Either way the order of the batch would start to
   * matter, which is exactly what the engine promises it never does.
   */
  for (const edit of edits) {
    if (edit.action !== 'edit') continue;
    const mine = rangeByAnchor.get(edit.anchor)!;
    const clash = edits.find((other) => {
      if (other.anchor === edit.anchor) return false;
      if (other.action !== 'replace' && other.action !== 'delete') return false;
      const theirs = rangeByAnchor.get(other.anchor);
      if (!theirs) return false;
      const insideThem = theirs.lineStart < mine.lineStart && theirs.lineEnd >= mine.lineEnd;
      const aroundThem = mine.lineStart < theirs.lineStart && mine.lineEnd >= theirs.lineEnd;
      return insideThem || aroundThem;
    });
    if (clash) {
      const theirs = rangeByAnchor.get(clash.anchor)!;
      const relation = theirs.lineStart < mine.lineStart ? 'lies inside' : 'encloses';
      throw new DomainError(
        'INVALID_ARGUMENT',
        `edit on '${edit.anchor}' ${relation} the section '${clash.anchor}' that another entry in this batch ${clash.action}s`,
        "split them into separate calls, or fold the substitution into the outer entry's content",
      );
    }
  }

  const order = [...edits].sort(
    (a, b) => rangeByAnchor.get(b.anchor)!.lineStart - rangeByAnchor.get(a.anchor)!.lineStart,
  );

  const scopeOf = new Map<string, string[]>();
  const replacementsOf = new Map<string, number>();

  for (const edit of order) {
    /**
     * Re-measured immediately before its own splice, never taken from the map
     * above: a section's range CONTAINS its subtree, so an edit lower in the
     * document may have changed how many lines this one spans even though it
     * cannot have moved its start.
     */
    const range = liveRangeOf(lines, edit.anchor);
    if (!range) {
      throw new DomainError(
        'SECTION_NOT_FOUND',
        `section '${edit.anchor}' was removed by another edit in the same batch`,
        'a batch may not both delete a section and address something inside it',
      );
    }
    if (edit.action === 'edit') {
      /**
       * The subtree, heading line excluded — the same span `replace` overwrites,
       * so an `edit` can no more swallow its own anchor comment than a `replace`
       * can. This is also the scope difference the release calls a trap worth
       * remembering: a top-level `textEdits` counts its matches over the WHOLE
       * plan, this one only over the addressed subtree.
       */
      const subtreeText = lines.slice(range.lineStart, range.lineEnd).join('\n');
      const applied = applyTextEdits(subtreeText, edit.textEdits ?? [], subtreePositionResolver(edit.anchor));
      replacementsOf.set(edit.anchor, applied.replacements);
      /**
       * Scope from the MATCHED FRAGMENTS, not from the addressed subtree — the
       * one place `edit` parts company with the other four actions. A
       * substitution three headings down destroys nothing above it.
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

  return { body: lines.join('\n'), scopeOf, replacementsOf };
}
