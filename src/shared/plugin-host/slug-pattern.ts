/**
 * Host API 2.0.0 — `slugPattern` and `computedDefault`, the DATA that replaces
 * `slugFrom`, the function.
 *
 * A function on a manifest can do anything: read the database, call a service,
 * return a different answer on the second call. That made slug derivation the
 * one part of a type's identity the host could neither inspect nor reproduce —
 * `c4s plugins doctor` could not tell you how a type names its entities, and the
 * client had to ship a second implementation (`legacy-adapter.ts` shipped a
 * `trivialSlugFrom` that simply did not work).
 *
 * The grammar is CLOSED: `literal | raw(field) | slugify(field) | truncate(n)`,
 * concatenated. Extending it is a Host API change, deliberately, because every
 * consumer (server write path, client preview, doctor) has to learn the new op.
 *
 * A slug is computed ONCE, at create. Changing a source field does not move an
 * entity; rename goes through `newSlug` and nothing else; rebuild reads the slug
 * from the file verbatim. So a pattern change is not a migration — it only
 * affects entities created after it.
 *
 * 0.2.22 makes this grammar serve TWO declarations rather than one. `title` is a
 * reserved field on every type and may be derived from other fields, so
 * `computedDefault` evaluates the same steps against the same payload. One
 * grammar, one evaluator, one validator — the alternative was a second
 * mini-language that would have had to be validated and previewed separately.
 *
 * Two consequences of that second audience:
 *   - `raw(field)` exists, because a TITLE keeps spaces and case where a slug
 *     may not. `endpoint.title` is `GET /orders/{id}`, whose slug is
 *     `get-orders-id`; the same grammar has to be able to say both.
 *   - `nanoid(n)` is GONE. A title is not allowed to be random — it is the
 *     entity's label — and `diagram`, its only consumer, now derives its slug
 *     from `title` and reports a duplicate as `SLUG_CONFLICT` rather than
 *     quietly minting a second entity behind a random suffix.
 */

import { slugify } from '../slug.js';

export type SlugStep =
  | { op: 'literal'; value: string }
  /**
   * A field pointer that does NOT slugify — the value verbatim.
   *
   * Only useful to `computedDefault`, and deliberately not restricted to it: a
   * grammar that means different things depending on which slot it is written in
   * is two grammars wearing one name. A `slugPattern` may use it; the slug is
   * then whatever the field says, which is a legal if unusual thing to declare.
   */
  | { op: 'raw'; field: string }
  /**
   * `splitCamelCase` is a PARAMETER of slugify, not a second op.
   *
   * The six built-in types need both readings and always have: `dto`, `ui-view`
   * and `design-system` slugify PascalCase names and must insert boundaries
   * (`UserProfile` → `user-profile`), while `ac` slugifies sentence text and
   * `endpoint` slugifies a URL path, where inserting boundaries would change
   * long-standing slugs. Collapsing them into one op would silently re-slug one
   * group or the other.
   */
  | { op: 'slugify'; field: string; splitCamelCase?: boolean }
  | { op: 'truncate'; n: number };

/**
 * A pattern, or an ordered chain of fallback patterns: the first alternative
 * producing a non-empty result wins. A single-alternative pattern is the common
 * case and is written as a bare step list.
 *
 * The chain existed for `diagram`'s three-step fallback ending in `nanoid(8)`.
 * With `title` required on every type, every in-repo pattern is now a single
 * alternative — but the chain stays in the shape, because a plugin deriving a
 * slug from an optional field still needs somewhere to fall back to.
 */
export type SlugPattern = SlugStep[] | SlugStep[][];

function isChain(pattern: SlugPattern): pattern is SlugStep[][] {
  return Array.isArray(pattern[0]);
}

/** Normalize either spelling to the chain form. */
export function alternativesOf(pattern: SlugPattern): SlugStep[][] {
  return isChain(pattern) ? pattern : [pattern];
}

function readField(data: Record<string, unknown>, field: string): string {
  // Dotted paths reach into a nested object; `a[0]` is deliberately unsupported —
  // a slug derived from a collection element would not be stable under reorder.
  let cursor: unknown = data;
  for (const part of field.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return '';
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor == null ? '' : String(cursor);
}

/**
 * Insert word boundaries into a PascalCase/camelCase identifier before slugifying.
 * The exact transform the retired `dtoSlug`/`uiViewSlug`/`designSystemSlug`
 * helpers applied — kept identical so no existing type re-slugs.
 */
function splitBoundaries(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2');
}

function evalAlternative(steps: SlugStep[], data: Record<string, unknown>): string {
  let out = '';
  for (const step of steps) {
    switch (step.op) {
      case 'literal':
        out += step.value;
        break;
      // Verbatim, including the absent case: a field nobody filled in
      // contributes nothing, exactly as under `slugify` below.
      case 'raw':
        out += readField(data, step.field);
        break;
      case 'slugify': {
        const raw = readField(data, step.field);
        /**
         * An ABSENT field contributes nothing — it does not go through
         * `slugify`.
         *
         * `slugify` never returns the empty string: input outside its
         * Latin-diacritic set (CJK, Cyrillic, pure punctuation) falls back to a
         * deterministic `x-<hash>`, so that a caller keying a filename off the
         * result never gets an empty path segment. That is right for a value
         * somebody actually typed, and wrong for a field nobody filled in —
         * passing `''` through would yield `x-0` and make every fallback chain
         * dead code, since the FIRST alternative would always look non-empty.
         * a fallback chain's first alternative would always look non-empty, and
         * an `ac` with no text would be named `ac-x-0`.
         *
         * A field that IS present but transliterates to nothing keeps the
         * `x-<hash>` form, which is the same answer every other slug consumer in
         * the repo gets for it.
         */
        if (raw.trim() === '') break;
        out += slugify(step.splitCamelCase ? splitBoundaries(raw) : raw);
        break;
      }
      case 'truncate':
        // Truncation applies to the ACCUMULATED result, not to one field's
        // input. That is what makes `truncate(n)` a bound on the slug rather
        // than on a source value, and it is why it appears last in every pattern.
        out = out.slice(0, step.n);
        break;
    }
  }
  // A pattern may leave a dangling separator ("get-" for an empty path, "ac-"
  // for empty text); trimming here means no pattern has to encode the cleanup.
  return out.replace(/^-+|-+$/g, '');
}

/**
 * Evaluate a pattern against a create payload.
 *
 * Returns `''` when every alternative is empty — the caller decides whether that
 * is a validation error (it is, on the generic write path) rather than this
 * function inventing a slug nobody asked for.
 */
export function evaluateSlugPattern(pattern: SlugPattern, data: Record<string, unknown>): string {
  for (const alternative of alternativesOf(pattern)) {
    const candidate = evalAlternative(alternative, data);
    if (candidate) return candidate;
  }
  return '';
}

/**
 * The same evaluation, named for its other caller.
 *
 * `computedDefault` fills a field the author left empty — today always `title`.
 * It is a distinct export rather than a comment at the call site because the two
 * uses have different failure modes: an empty slug is a write error, while an
 * empty computed default just means the field stays unset and the type's
 * `required` rule decides what happens next.
 */
export function evaluateComputedDefault(
  steps: SlugPattern,
  data: Record<string, unknown>,
): string {
  return evaluateSlugPattern(steps, data);
}

/**
 * Evaluate a pattern for DISPLAY.
 *
 * The client shows a prospective slug while the user types; the server computes
 * the real one, resolves collisions and is the only authority. Since 0.2.22 the
 * grammar is fully deterministic (no `nanoid`), so this is the same evaluation —
 * kept as a named export because the CALLER is different, and because the
 * distinction is what stopped the client from shipping its own slug functions.
 *
 * This is what lets the four in-repo client modules delete their hand-copied
 * slug functions: `acSlugClient` and the two inlined `replace` chains in
 * `ui-view`/`design-system` were mirrors of server code, maintained by hand and
 * already drifting (the client's ac mirror kept the `ac-` de-duplication the
 * grammar drops).
 */
export function previewSlugPattern(pattern: SlugPattern, data: Record<string, unknown>): string {
  return evaluateSlugPattern(pattern, data);
}

/** Every field a pattern reads. Used by validation to reject a pattern naming an unknown field. */
export function slugPatternFields(pattern: SlugPattern): string[] {
  const fields: string[] = [];
  for (const alternative of alternativesOf(pattern)) {
    for (const step of alternative) {
      if (step.op === 'slugify' || step.op === 'raw') fields.push(step.field);
    }
  }
  return fields;
}

/** True when the pattern can produce a value without reading any field. */
export function slugPatternIsTotal(pattern: SlugPattern): boolean {
  return alternativesOf(pattern).some((alt) =>
    alt.some((s) => s.op === 'literal' && s.value !== ''),
  );
}
