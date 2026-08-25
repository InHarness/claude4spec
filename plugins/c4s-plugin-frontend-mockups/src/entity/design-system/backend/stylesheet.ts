/**
 * The design system's token → CSS sheet generator: the pure half of the second
 * domain method on `design-system`'s `backend.service`.
 *
 * It is PURE and lives beside `design-system-domain.ts` for the same reason
 * `resolve()` does — the sheet is a function of resolved tokens and nothing
 * else, so it needs neither the DB nor the host to be tested.
 *
 * WHAT THIS FILE IS NOT: it is not the isolation contract. Nothing here defends
 * the document that embeds the sheet — that is the route's
 * `Content-Security-Policy: sandbox` header, and only that. The rules below are
 * STRUCTURAL: they keep a hostile token name or value from restructuring the
 * sheet it lands in, which is a correctness property, not a security boundary.
 */

import { SAFE_CSS_NAME, UNRESOLVED_TOKEN, type ResolvedTokenValue } from '../../../types.js';

/**
 * One resolved mode: its name and the tokens `resolve(groups, modes, name)`
 * produced for it.
 *
 * The generator takes RESOLVED input on both axes rather than `groups`/`modes`,
 * because a sheet needs one block per mode and `resolve()` answers for exactly
 * one mode at a time — so the per-mode `resolve()` calls belong to the caller,
 * which is the only place that knows which modes exist.
 */
export interface ResolvedMode {
  name: string;
  tokens: Record<string, ResolvedTokenValue>;
}

/**
 * The name filter, applied to a token name, a composite FIELD name and a mode
 * name alike. A name outside it is skipped in silence — never an exception:
 * one unusable token must not cost the author the whole sheet, and the document
 * that embeds it still has to render.
 *
 * Shared with the linter through `types.ts` rather than declared here: the
 * linter's warning and this filter have to describe the same set, or an author
 * gets a clean lint and a missing declaration.
 */
const SAFE_NAME = SAFE_CSS_NAME;

/**
 * The first of the sheet's three layers. Deliberately tiny and opinion-free:
 * the mockup's own markup owns its look, and every declaration added here is
 * one an author would have to fight.
 */
const RESET = [
  '*, *::before, *::after { box-sizing: border-box; }',
  'body { margin: 0; }',
  'img, svg, video { max-width: 100%; }',
].join('\n');

/**
 * Serialize a token value so it can only ever be a DECLARATION VALUE.
 *
 * Escaping, NOT a blacklist — and that is the whole point. A blacklist on
 * `}` / `</` / `@import` would break a legitimate `url(...)` in a background
 * token while still letting `/*` and a trailing `\` through. Escaping the few
 * characters that can end a value, a rule or the host `<style>` element closes
 * the structural hole without having an opinion about the CSS itself.
 *
 * PARENTHESES ARE LEFT ALONE, deliberately: escaping them would destroy
 * `url()`, `calc()` and `rgba()`, which is most of what real tokens contain.
 * An UNBALANCED paren is handled by dropping the token instead — see
 * `parensBalanced` — because that is the one case where a paren could swallow
 * the declarations that follow it.
 */
export function serializeValue(raw: string): string {
  return raw
    // First, so the escapes added below cannot be re-escaped: a trailing
    // backslash would otherwise escape our own `;` and eat the next line.
    .replace(/\\/g, '\\\\')
    // `}` ends the rule, `;` the declaration, `{` opens one.
    .replace(/[{};]/g, (c) => `\\${c}`)
    // Only the COMMENT OPENER, not every slash: `url(/img/a.png)` and the
    // `16px/1.5` of a font shorthand are ordinary token values.
    .replace(/\/\*/g, '\\/*')
    // A HEX escape, not `\<`: the HTML tokenizer scanning the host `<style>`
    // element looks for the literal text `</style`, and `\</style>` still
    // contains it. `\3c ` leaves no `<` in the byte stream at all.
    .replace(/</g, '\\3c ')
    // A newline inside a declaration value is not valid CSS to begin with.
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/**
 * Whether `(` and `)` pair up. An unbalanced `(` makes the CSS parser consume
 * forward looking for its match, taking the declarations after it along; since
 * parens are the one thing left unescaped, this is the check that keeps them
 * safe. A token that fails it is dropped in silence, like a bad name.
 */
function parensBalanced(raw: string): boolean {
  let depth = 0;
  for (const c of raw) {
    if (c === '(') depth++;
    else if (c === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/** `unresolved` — an alias cycle or a missing target. */
function isUnresolved(v: unknown): boolean {
  return v === UNRESOLVED_TOKEN;
}

/**
 * One token → zero or more declaration lines.
 *
 * A COMPOSITE token (`typography` / `shadow`, whose resolved value is an
 * object) is flattened one custom property per field rather than joined into a
 * single shorthand. A shorthand would have to know each type's field ORDER and
 * its separators, which is exactly the kind of per-type knowledge this
 * generator has none of; per-field also lets a mockup use one field on its own.
 *
 * The flattened name is `--<token>-<fieldKey>`, the field key VERBATIM —
 * camelCase preserved, never kebab-cased. A `typography` token `heading-1` with
 * a field `fontSize` emits `--heading-1-fontSize: 36px;` and is consumed as
 * `var(--heading-1-fontSize)`. If this comment and the code below ever disagree,
 * THE CODE IS RIGHT and the comment is the defect: a `var()` naming a property
 * that was never emitted fails silently, so a wrong rule here produces no error,
 * just quietly wrong styling.
 *
 * Two rules drop output in silence — nothing warns, nothing throws, the
 * declaration simply is not there:
 *
 * - `SAFE_NAME` (`/^[A-Za-z0-9_-]+$/`) is tested at three points: the token
 *   name (here), the composite field key (here), and the mode name (in
 *   `generateStylesheet`). The granularity is the trap — a rejected field key
 *   drops THAT FIELD ALONE while its siblings emit normally, so a partially
 *   emitted composite is an expected outcome, not a bug.
 * - A value whose parens do not balance is dropped whole (see
 *   `parensBalanced` for why parens in particular).
 *
 * `unresolved` becomes a COMMENT, never an empty value: an empty custom
 * property is a legal declaration that reads as a deliberate zeroing, so the
 * one state the author most needs to see would be the one that looks intended.
 */
function declarationsFor(name: string, value: ResolvedTokenValue): string[] {
  if (!SAFE_NAME.test(name)) return [];

  if (typeof value === 'string') {
    if (isUnresolved(value)) return [`  /* ${name}: unresolved */`];
    if (!parensBalanced(value)) return [];
    return [`  --${name}: ${serializeValue(value)};`];
  }

  const out: string[] = [];
  for (const [field, fieldValue] of Object.entries(value ?? {})) {
    if (!SAFE_NAME.test(field)) continue;
    if (isUnresolved(fieldValue)) {
      // Per FIELD: a composite whose colour failed still has a usable blur.
      out.push(`  /* ${name}-${field}: unresolved */`);
      continue;
    }
    if (!parensBalanced(String(fieldValue))) continue;
    out.push(`  --${name}-${field}: ${serializeValue(String(fieldValue))};`);
  }
  return out;
}

/** Two resolved values are the same token — used to keep mode blocks to overrides. */
function sameValue(a: ResolvedTokenValue | undefined, b: ResolvedTokenValue): boolean {
  if (a === undefined) return false;
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

/**
 * The sheet: reset, `:root` base tokens, then ONE BLOCK PER MODE.
 *
 * The mode selector is `[data-preview-mode="<name>"]` and is ELEMENT-AGNOSTIC
 * on purpose — never `body[data-preview-mode]`. That is what lets a mockup
 * author activate a mode today with no script at all, by wrapping a subtree in
 * `<div data-preview-mode="dark">`: custom properties inherit, so the override
 * covers everything below it. The same selector serves a future `<body>`-level
 * switcher without changing. (Mapping modes onto
 * `@media (prefers-color-scheme)` was rejected: mode names are arbitrary.)
 *
 * A mode block carries ONLY what differs from base. A mode IS a set of
 * `overrides` in the data model — "Base = no overrides" — so re-emitting the
 * identical tokens would be restating the cascade the inheritance above already
 * gives for free.
 */
export function generateStylesheet(
  base: Record<string, ResolvedTokenValue>,
  modes: ResolvedMode[] = [],
): string {
  const blocks: string[] = [RESET];

  const rootLines: string[] = [];
  for (const [name, value] of Object.entries(base ?? {})) {
    rootLines.push(...declarationsFor(name, value));
  }
  if (rootLines.length) blocks.push(`:root {\n${rootLines.join('\n')}\n}`);

  for (const mode of modes ?? []) {
    // An unusable mode name must not produce a selector that breaks the sheet
    // — the remaining blocks still have to apply.
    if (!SAFE_NAME.test(mode.name)) continue;
    const lines: string[] = [];
    for (const [name, value] of Object.entries(mode.tokens ?? {})) {
      if (sameValue(base?.[name], value)) continue;
      lines.push(...declarationsFor(name, value));
    }
    if (lines.length) {
      blocks.push(`[data-preview-mode="${mode.name}"] {\n${lines.join('\n')}\n}`);
    }
  }

  return blocks.join('\n\n') + '\n';
}
