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

/** The entity type names. `typeTablePrefix` turns these into `ui_view` / `design_system`. */
export const UI_VIEW_TYPE = 'ui-view';
export const DESIGN_SYSTEM_TYPE = 'design-system';

/**
 * The REST prefixes, mounted under `/api` by the host — `/api/ui-views`,
 * `/api/design-systems`.
 *
 * Written out rather than derived: nothing in the host pluralises, and the
 * existing prefixes prove why (`ac` → `/acs`). They are also the client-side
 * route prefixes, which is what keeps `openEntityRoute` and the serializer's
 * `href` agreeing.
 */
export const UI_VIEW_PATH_PREFIX = '/ui-views';
export const DESIGN_SYSTEM_PATH_PREFIX = '/design-systems';

export const UI_VIEW_LABEL = 'UI View';
export const UI_VIEW_LABEL_PLURAL = 'UI Views';
export const DESIGN_SYSTEM_LABEL = 'Design System';
export const DESIGN_SYSTEM_LABEL_PLURAL = 'Design Systems';

/**
 * Sidebar positions, inherited from the host registration so neither tab moves
 * when the types change delivery path. `ac` sits at 50 between them.
 */
export const UI_VIEW_DISPLAY_ORDER = 40;
export const DESIGN_SYSTEM_DISPLAY_ORDER = 60;

/**
 * The slash-create popover discriminators.
 *
 * Each command is declared ONCE, on the manifest's `commands` contribution,
 * which is the only declaration carrying a `popoverKind` for `invokeSlash` to
 * dispatch on. Declaring one a second time as a `slashCommand` on
 * `editorExtensions` makes the palette prefer the module-borne entry, which
 * deletes the typed text and opens nothing.
 */
export const UI_VIEW_POPOVER_KIND = 'ui-view-create';
export const DESIGN_SYSTEM_POPOVER_KIND = 'design-system-create';

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

/**
 * Both slug patterns are `{ op: 'slugify', field: 'name', splitCamelCase: true }`,
 * so `UserProfile` → `user-profile` and `HTTPCache` → `http-cache`.
 *
 * The two `replace` calls are `splitBoundaries` from the host's
 * `shared/plugin-host/slug-pattern.ts`, vendored for the same reason `slugify`
 * is: the client computes a slug to decide whether a rename happened, and a
 * client that drops the second (acronym) boundary disagrees with the server on
 * every name containing one.
 */
export function slugifyEntityName(name: string): string {
  return slugify(
    name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2'),
  );
}
