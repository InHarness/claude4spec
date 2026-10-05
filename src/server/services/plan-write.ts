import { DomainError } from './tags.js';
import { assertHeadingText, parseBody } from './section-text.js';
import { composeSectionBatch, type BatchElementOutcome } from './section-batch.js';
import type { TextEdit } from './text-edits.js';

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
 * The six section actions, identical to `update_sections`'.
 *
 * Note `insert_after`, not the plan's old `insert_after_section`: the name is
 * now the page's, because the behaviour is.
 *
 * 0.2.100 adds `rename`, and it means here exactly what it means there — the
 * heading line alone, level and anchor kept. What differs is what plans do not
 * have: no `dropAnchors`, no `ANCHOR_LOSS`, because a plan's anchors are
 * plan-local and nothing outside the file can cite one.
 *
 * 2.1.7 — the batch rules are the page's, from the same engine
 * (`section-batch.ts`): `replace` writes the OWN body, one anchor may carry
 * several actions, and colliding claims refuse the batch.
 */
export type PlanEditAction = 'replace' | 'append' | 'insert_after' | 'delete' | 'edit' | 'rename';

export const PLAN_EDIT_ACTIONS: readonly PlanEditAction[] = [
  'replace',
  'append',
  'insert_after',
  'delete',
  'edit',
  'rename',
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
  /** Required for `replace`/`append`/`insert_after`, forbidden for `delete`, `edit` and `rename`. */
  content?: string;
  /** Required for `edit`, forbidden for the other five. */
  textEdits?: TextEdit[];
  /**
   * 0.2.100 — required for `rename`, forbidden for the other five: the new
   * heading as PLAIN TEXT, one line, no leading `#`, no anchor comment, not
   * empty once trimmed. The level is kept from the line being replaced.
   */
  heading?: string;
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
  /**
   * 0.2.100 — `rename` only: the heading text as it stood before the write. The
   * key is ABSENT on every other row, the whole-plan rows included.
   */
  previousHeading?: string;
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
    if (edit.action !== 'rename' && edit.heading !== undefined) {
      throw new DomainError(
        'INVALID_ARGUMENT',
        `edit for '${edit.anchor}' carries heading, which only action 'rename' accepts`,
        `action '${edit.action}' does not rewrite a heading line`,
      );
    }
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
    } else if (edit.action === 'rename') {
      if (edit.content !== undefined) {
        throw new DomainError(
          'INVALID_ARGUMENT',
          `edit for '${edit.anchor}' takes heading, not content — action 'rename' rewrites the heading line, it does not touch the body`,
        );
      }
      if (edit.textEdits !== undefined) {
        throw new DomainError(
          'INVALID_ARGUMENT',
          `edit for '${edit.anchor}' carries textEdits, which only action 'edit' accepts`,
          "action 'rename' describes its new heading in `heading`",
        );
      }
      assertHeadingText(edit.heading, edit.anchor);
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
  }
  return edits;
}

export interface PlanBatchOutcome {
  /** The plan body after every edit has been composed, in memory. */
  body: string;
  /** Per element, in input order: scope, replacements, previous heading. */
  outcomes: BatchElementOutcome[];
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
 * ## A set, not a sequence
 *
 * Every element claims part of the plan as it was before the write; colliding
 * claims refuse the batch and the rest compose in one pass with a fixed
 * insertion order, so two orderings of the same batch produce identical text.
 * (`results[]` still comes back in the order given — that is the caller's
 * frame, not the engine's.)
 */
export function applyPlanBatch(body: string, edits: readonly PlanSectionEdit[]): PlanBatchOutcome {
  const lines = body.split('\n');

  /**
   * A duplicate anchor inside the plan file itself is a defect to fix in the
   * plan, not a target to guess at. The batch engine settles duplicates by first
   * occurrence (it must, to agree with every other reader), so the ambiguity has
   * to be detected here or it would be silently resolved in the caller's favour.
   * The same count answers "is there such a section at all".
   */
  const occurrences = new Map<string, number>();
  for (const sec of parseBody(lines).sections) {
    if (sec.anchor) occurrences.set(sec.anchor, (occurrences.get(sec.anchor) ?? 0) + 1);
  }

  for (const edit of edits) {
    if ((occurrences.get(edit.anchor) ?? 0) > 1) {
      throw new DomainError(
        'AMBIGUOUS_ANCHOR',
        `anchor '${edit.anchor}' matches ${occurrences.get(edit.anchor)} sections of this plan`,
        'an anchor names exactly one section — remove the duplicate from the plan',
      );
    }
    if (!occurrences.has(edit.anchor)) {
      throw new DomainError(
        'SECTION_NOT_FOUND',
        `section '${edit.anchor}' not found in this plan`,
        'read the plan with get_plan and take the anchor from an `<!-- anchor: … -->` comment',
      );
    }
  }

  const composed = composeSectionBatch(lines, edits);

  /**
   * 2.1.7 — a `replace` (or any insert) whose `content` carries the anchor of a
   * section already in the plan would leave two sections answering to one
   * anchor; refused as a duplicate anchor, for the whole batch. Plans carry no
   * `ANCHOR_DUPLICATE` code (the brief adds none), so the refusal is
   * `INVALID_ARGUMENT`, like every other deterministic refusal of the batch.
   */
  const after = new Map<string, number>();
  for (const sec of parseBody(composed.lines).sections) {
    if (sec.anchor) after.set(sec.anchor, (after.get(sec.anchor) ?? 0) + 1);
  }
  const duplicated = [...after].filter(([a, n]) => n > 1 && (occurrences.get(a) ?? 0) < n).map(([a]) => a);
  if (duplicated.length > 0) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `duplicate anchor — this batch would bring in ${duplicated.length === 1 ? 'an anchor' : 'anchors'} the plan already carries: ${duplicated.map((a) => `'${a}'`).join(', ')}`,
      'remove the anchor comments from the content you send — replace keeps the subsections, so their anchors stay where they are',
    );
  }

  return { body: composed.lines.join('\n'), outcomes: composed.outcomes };
}
