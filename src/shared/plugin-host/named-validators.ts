/**
 * The registry behind the `kind` constraint — named validators, resolved to HOST
 * CODE rather than to an expression in the declaration.
 *
 * That is the whole distinction the axis exists to draw. A type says
 * `kind: 'sql-identifier'`; what the name MEANS lives here, on the host's side of
 * the boundary, where it can be fixed, extended and screened once. The
 * alternative the specification refuses is a raw `pattern` on the declaration:
 * `minLength` and `pattern` are not in the dictionary and are not coming, and
 * `kind` is their replacement rather than a gateway back to them. A field with a
 * fixed format gets a named validator or it gets nothing.
 *
 * IT LIVES IN `shared/` for the same two-reader reason `sql-reserved-words` does:
 * the write path enforces these rules on the server, and `describe_*` publishes
 * them to a caller before a write can trip over one. Two copies would drift on
 * the first validator anybody adds.
 *
 * ADDING AN ENTRY IS A HOST API CHANGE. The dictionary of validator names is
 * versioned surface on exactly the same footing as the dictionary of field flags:
 * a manifest may name only what the host already knows, so a new name has to be
 * qualified at the loader gate rather than slipping in unnoticed.
 */

import { SQL_RESERVED_WORDS } from './sql-reserved-words.js';

/** The name a declaration may put in `kind`. Closed — one entry today. */
export type ValidatorKind = 'sql-identifier';

/** Why a value was refused. The two arms carry DIFFERENT messages on purpose. */
export type ValidatorFailure = 'shape' | 'reserved';

/**
 * A letter or underscore, then letters, digits or underscores.
 *
 * CASE-INSENSITIVE ON PURPOSE, and this is the one rule most likely to be
 * "corrected" by a later reader. Two rules meet on the field this validator
 * guards, and a strictly-lowercase shape makes the second unreachable: the value
 * must be an identifier, AND `Order_Items` / `ORDER_ITEMS` / `order_items` must
 * all be creatable while collapsing onto the one slug `order-items`. Lowercasing
 * belongs to `slugify`; a shape check has no business repeating it.
 */
const SQL_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface NamedValidator {
  /** Prose for `describe_*`, so a caller learns the rule before a rejection teaches it. */
  readonly describe: string;
  /** `null` when the value passes. */
  check(value: string): ValidatorFailure | null;
}

const VALIDATORS: Readonly<Record<ValidatorKind, NamedValidator>> = {
  'sql-identifier': {
    describe:
      'a letter or underscore, then letters, digits or underscores, and never a reserved SQL word',
    check(value) {
      if (!SQL_IDENTIFIER_RE.test(value)) return 'shape';
      /**
       * Membership, checked SEPARATELY from the shape — never folded into the
       * pattern as a negative lookahead. A 123-alternative lookahead is
       * unreviewable, is case-sensitive where the rule is not, and collapses
       * "that word is reserved", which tells an author what to do, into a
       * generic shape mismatch, which does not.
       */
      if (SQL_RESERVED_WORDS.has(value.toLowerCase())) return 'reserved';
      return null;
    },
  },
};

/** Every registered name — for the registration error that rejects an unknown one. */
export const VALIDATOR_KINDS = Object.keys(VALIDATORS) as ValidatorKind[];

export function isValidatorKind(name: string): name is ValidatorKind {
  return Object.prototype.hasOwnProperty.call(VALIDATORS, name);
}

/** What `describe_*` publishes for a field carrying this validator. */
export function describeValidator(kind: ValidatorKind): string {
  return VALIDATORS[kind].describe;
}

/** `null` when the value passes; otherwise which of the two rules it broke. */
export function checkValidator(kind: ValidatorKind, value: string): ValidatorFailure | null {
  return VALIDATORS[kind].check(value);
}

/**
 * The message a caller sees, per failure arm.
 *
 * Written here rather than at the zod call site because the payload-upgrade step
 * refuses with the same words: a migration that rewrites a value and a write that
 * rejects one are answering the same question, and an author reading the two
 * should not have to work out that they mean the same thing.
 */
export function validatorMessage(kind: ValidatorKind, failure: ValidatorFailure, value: string): string {
  if (failure === 'reserved') {
    return `"${value}" is a reserved SQL word`;
  }
  return `"${value}" is not a valid ${kind} — ${describeValidator(kind)}`;
}
