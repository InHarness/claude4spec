/**
 * 2.1.26 — the rules vocabulary of a catalog row: the record's `reguly`.
 *
 * M43 owns the wording of every shared rule and gives each a stable identifier
 * (M43 `ke1jxhqh`, its "Reguły wiążące operację", "Kontrakt trybu różnicowego"
 * and "Reguły paczki sekcyjnej" subsections). A row CITES a rule by that
 * identifier and never restates it (`hdqhc8xp`): an element of `rules` is an
 * identifier, optionally with the reason it is excluded — nothing else. A row
 * bound by none of the rules no field closes carries exactly one `{ id: 'n/d' }`;
 * an empty list is not a value (L3 `g8adono9`).
 *
 * The vocabulary is CLOSED (M43 `k0ddfllq`): an identifier outside it is a
 * specification error, not an extension, and adding one is a change of M43.
 */

/** Every identifier M43's domain section declares, in the order it declares them. */
export const RULE_IDS = [
  'echo-free',
  'guard-declared',
  'destructive-declared',
  'batch-required',
  'rename-heading-only',
  'error-code-once',
  'explicit-addressing',
  'operation-only-write',
  'diff-mode-declared',
  'literal-match',
  'match-count-declared',
  'edit-set-not-procedure',
  'replacements-returned',
  'diff-field-names',
  'claimed-spans-disjoint',
  'insertion-order',
  'delete-exclusive',
  'one-action-per-anchor',
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/**
 * The three rules a record FIELD closes (M43 `k0ddfllq`): `guard-declared` by
 * `guard`, `batch-required` by `krotnosc`, `diff-mode-declared` by `opisTresci`
 * (the row's {@link OperationDeclaration.contentInput}). Citing one of them in
 * `rules` repeats what the field beside it already says, so a row never does.
 */
export const FIELD_CLOSED_RULES: ReadonlySet<RuleId> = new Set<RuleId>([
  'guard-declared',
  'batch-required',
  'diff-mode-declared',
]);

/** The one element of a row no remaining rule binds. */
export const NO_RULE = 'n/d' as const;

/** Upper bound of an exclusion reason (the record's `wykluczenie`, L3 `g8adono9`). */
export const EXCLUSION_MAX_LENGTH = 300;

/**
 * One element of a row's `rules`: the cited identifier, and — for an exclusion —
 * the reason it does not bind (the record's `wykluczenie`, verbatim).
 */
export interface RuleCitation {
  readonly id: RuleId | typeof NO_RULE;
  readonly exclusion?: string;
}

const RULE_ID_SET: ReadonlySet<string> = new Set(RULE_IDS);

/**
 * Why a `rules` list is not a valid citation list, or `null` when it is.
 * Mechanical, like the rest of `register()`'s checks: shape, not wording.
 */
export function rulesProblem(rules: readonly RuleCitation[]): string | null {
  if (rules.length === 0) return "'rules' is empty — cite identifiers, or one { id: 'n/d' }";
  const seen = new Set<string>();
  for (const element of rules) {
    const keys = Object.keys(element);
    const extra = keys.filter((k) => k !== 'id' && k !== 'exclusion');
    if (extra.length > 0) return `a 'rules' element carries ${extra.join(', ')} — only 'id' and 'exclusion'`;
    if (element.id === NO_RULE) {
      if (rules.length !== 1) return "'n/d' stands alone in 'rules'";
      if (element.exclusion !== undefined) return "'n/d' carries no exclusion";
      continue;
    }
    if (!RULE_ID_SET.has(element.id)) return `'${element.id}' is not an identifier of the M43 rules vocabulary`;
    if (FIELD_CLOSED_RULES.has(element.id)) return `'${element.id}' is closed by a record field and is not cited`;
    if (seen.has(element.id)) return `'${element.id}' is cited twice`;
    seen.add(element.id);
    if (element.exclusion !== undefined) {
      const reason = element.exclusion.trim();
      if (reason.length === 0) return `the exclusion of '${element.id}' has no reason`;
      if (element.exclusion.length > EXCLUSION_MAX_LENGTH) {
        return `the exclusion of '${element.id}' is longer than ${EXCLUSION_MAX_LENGTH} characters`;
      }
    }
  }
  return null;
}
