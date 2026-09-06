/**
 * The two constants rules 15-17 need, kept OUT of `consistency.ts` for one
 * reason: they are also the definition a plugin-side test wants to assert
 * against, and the core cannot import from `plugins/`.
 *
 * The type name is duplicated rather than shared, and the duplication is
 * deliberate. `c4s-plugin-layered-vertical-slices` is a BUILT-IN envelope today
 * and an extractable npm package tomorrow; the core importing a value out of it
 * would make the dependency point the wrong way. What the core is entitled to
 * know is the NAME of a type it has rules about — the same way `check_consistency`
 * already knows the string `'ac'` without importing the AC envelope.
 */

/** The type rules 15-17 judge. Contributed by `c4s-plugin-layered-vertical-slices`. */
export const MODULE_DEPENDENCY_TYPE = 'module-dependency';

/**
 * The shape a module identifier takes in the layered-vertical-slices style —
 * `M03`, `m19`.
 *
 * NOT anchored to the whole value: rule 16 looks for the token ANYWHERE inside
 * `needs`, since the failure is a sentence that names a module, not a field
 * whose entire content is a module number.
 *
 * No `g` flag, on purpose. A global regex carries `lastIndex` between `.test()`
 * calls, so a shared instance would answer differently on every second row —
 * reporting roughly half the offending edges and looking, from the report, like
 * a rule that works.
 */
export const MODULE_ID_PATTERN = /\bM\d+\b/i;
