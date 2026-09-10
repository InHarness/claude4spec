/**
 * Every constant both halves of this envelope agree on, and the one derivation
 * they share.
 *
 * DELIBERATELY `.ts`, NOT `.tsx`, AND FREE OF REACT. The Node loader imports
 * `src/index.ts`, which reaches this file; if a React import were reachable from
 * here the backend bundle would pull the whole renderer into a process that has
 * no DOM. The frontend imports the same names from the same place, so the two
 * halves cannot drift on a table name or a path prefix — the failure mode that
 * produces a list screen calling a route the router never mounted.
 */

/** The entity type name. `typeTablePrefix` turns this into the `ac` table. */
export const AC_TYPE = 'ac';

/**
 * The REST prefix, mounted under `/api` by the host — `/api/acs`.
 *
 * Written out rather than derived: nothing in the host pluralises, and this
 * prefix is the reason why (`ac` → `/acs`, not `/acies`). It is also the
 * client-side route prefix, which is what keeps `openEntityRoute` and the
 * serializer's `href` agreeing.
 */
export const AC_PATH_PREFIX = '/acs';

export const AC_LABEL = 'Acceptance Criterion';
export const AC_LABEL_PLURAL = 'Acceptance Criteria';

/**
 * Sidebar position, inherited from the host registration so the tab does not
 * move when the type changes delivery path. It sits between `ui-view` (40) and
 * `design-system` (60).
 */
export const AC_DISPLAY_ORDER = 50;

/**
 * The slash-create popover discriminator.
 *
 * The command is declared ONCE, on the manifest's `commands` contribution,
 * which is the only declaration carrying a `popoverKind` for `invokeSlash` to
 * dispatch on. Declaring it a second time as a `slashCommand` on
 * `editorExtensions` makes the palette prefer the module-borne entry, which
 * deletes the typed text and opens nothing.
 */
export const AC_POPOVER_KIND = 'ac-create';

/**
 * The bound on the criterion, mirrored from `data.schema`.
 *
 * The create form counts against it so a user is stopped at the field rather
 * than by a 400. It is deliberately WIDER than the host's default of 200 — see
 * the schema for why 500 is a forcing function rather than an estimate.
 */
export const AC_TITLE_MAX_LENGTH = 500;

/**
 * The ONLY truncation `ac` performs, and it happens in the renderers rather than
 * anywhere near the data.
 *
 * Two different shortenings used to be confused with each other. TRANSPORT never
 * shortens a title: `maxLength: 500` sits far below the read budget, the host
 * refuses any type that would change that, and no read marks a title truncated.
 * DISPLAY is a different question with a different answer — a chip sitting
 * inline in a paragraph, or a row in a sidebar list, has room for a few words,
 * and since 0.2.51 an AC's title is the whole criterion rather than a label for
 * it, so "render it as stored" would put a 500-character sentence inside a pill.
 *
 * 40 characters is the width at which a criterion is still recognisable and a
 * chip still reads as a chip. The full text is one hover away, and one click
 * away on the detail page, where nothing is cut at all.
 */
export const CHIP_LABEL_CHARS = 40;

export function shortLabel(title: string): string {
  return title.length > CHIP_LABEL_CHARS ? `${title.slice(0, CHIP_LABEL_CHARS).trimEnd()}…` : title;
}

/**
 * The HOST's slug normalisation, vendored byte-for-byte from `src/shared/slug.ts`.
 *
 * A detail panel only sends `newSlug` when the slug it computes DIFFERS from the
 * current one, so a client that disagrees with the server about slugification
 * either renames when it should not or fails to when it should. That makes this
 * a correctness dependency, not a convenience.
 *
 * `ł` has no NFD decomposition, so an NFKD-only implementation slugifies
 * `Zbiórka_Ł` one way in the browser and another on the server. The explicit
 * `ł → l` map below is the host's fix, and half the real corpus is Polish.
 *
 * Vendored rather than imported because `@c4s/plugin-runtime` does not export
 * it; if it ever does, delete this and import it.
 */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base) return base;
  // An input outside the Latin-diacritic set (CJK, Cyrillic, …) or pure
  // punctuation collapses to '' above; a deterministic fallback keeps the
  // result non-empty and never dot-prefixed.
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return `x-${hash.toString(36)}`;
}
