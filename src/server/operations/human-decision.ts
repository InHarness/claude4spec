/**
 * 2.1.67 — the catalog of human decisions (M43 `rp99fpc1`, L3 `g8adono9`).
 *
 * A catalog row belongs here when triggering the operation is itself a human's
 * decision, because it meets one of the three premises below. Such a row
 * carries the tag `decyzja-czlowieka` (`HUMAN_DECISION_TAG`); a row that meets
 * none of them does not. Attached by `registerCoreOperations()` like
 * `OPERATION_RULES`.
 *
 * The catalog is an axis apart from the mediation class: a row here may be
 * `direct` with an agentic channel (`release_create`, `mark_plan_applied`). The
 * tag takes no tool away from an agent — only a profile's operation set does
 * (M43 `l3media0`, point 1) —; it says an agent does not use or approve it
 * without a human.
 *
 * Not in the catalog: `mark_patch_applied` (2.1.74, M23 `m23pctx1`) — it
 * declares the outcome of the patch thread's own work, the thread whose one task
 * is folding that patch in, not someone else's work; the patch thread's agent
 * sets it whether the thread was opened from the UI button, by a turn command
 * in a terminal or by the bubble dispatcher, and the user still unsets it in
 * the UI. Nor deleting a page or an entity — they come back through
 * versions and releases, and the plan ordering them is already a human's
 * decision.
 *
 * Who reads it: the author of a Run agent definition, who copies it into the
 * definition's content BY NAME (M55 `nosqcr6z`; `plan-execution-agent.ts`). The
 * agent in the container does not read the catalog.
 */

/** The premises of M43 `rp99fpc1`, one of which a tagged row meets. */
export type HumanDecisionPremise =
  /** Freezes or replaces the state of the specification others see (a release, a release restore). */
  | 'freezes-or-replaces-shared-state'
  /** Marks someone else's work as done or accepted (a plan, a brief; a shadow accept). */
  | 'marks-others-work'
  /** No catalog operation undoes its effect. */
  | 'irreversible';

/** Each tagged row by canonical name, with the premise it meets. */
export const HUMAN_DECISION_OPERATIONS: Readonly<Record<string, HumanDecisionPremise>> = Object.freeze({
  release_create: 'freezes-or-replaces-shared-state',
  release_update: 'freezes-or-replaces-shared-state',
  release_restore: 'freezes-or-replaces-shared-state',
  accept_shadow: 'marks-others-work',
  mark_plan_applied: 'marks-others-work',
  mark_brief_implemented: 'marks-others-work',
  delete_thread: 'irreversible',
});
