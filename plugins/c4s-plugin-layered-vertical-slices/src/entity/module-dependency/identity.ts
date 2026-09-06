/**
 * Identity of the type this envelope contributes.
 *
 * REACT-FREE on purpose, for the same reason as every other envelope's identity
 * module: `src/index.ts` is the entry the host's NODE loader imports, and it
 * reaches these constants through `manifest.ts`. Pulling a string literal out of
 * a `.tsx` would put React on the server's plugin-load path.
 */

export const MODULE_DEPENDENCY_TYPE = 'module-dependency';

/** The projection table the host derives from `data.schema`. */
export const MODULE_DEPENDENCY_TABLE = 'module_dependency';

/**
 * The prefix WITHOUT `/api`, matching every other type in the repo.
 *
 * The generated router is mounted onto a router that already sits at `/api`
 * (`project-context.ts`: `router.use(module.pathPrefix, generatedCrudRouter(…))`),
 * so the served path is `/api/module-dependencies`. Declaring it in full here
 * would produce `/api/api/module-dependencies` — a type whose every route 404s
 * while the declaration reads as though it were right.
 */
export const MODULE_DEPENDENCY_PATH_PREFIX = '/module-dependencies';
export const MODULE_DEPENDENCY_LABEL = 'Module dependency';
export const MODULE_DEPENDENCY_LABEL_PLURAL = 'Module dependencies';

/**
 * The type is HIDDEN — the frontend module declares no `sidebarTab`, no `routes`
 * and no `detailPanel` — so this never orders anything in the UI. It exists
 * because `EntityModuleManifest` requires it, and it still orders the type in
 * catalogues, release snapshots and diffs. Last, after `code-snippet`'s 110.
 */
export const MODULE_DEPENDENCY_DISPLAY_ORDER = 120;

/**
 * The shape a module identifier takes in this style — `M03`, `m19`.
 *
 * Used by the consistency rules, NEVER by the schema: `dependent` and `provider`
 * describe an OPEN set of modules, so neither `enum` nor `maxLength` can
 * express it, and the host's named-validator dictionary is closed. The shape is
 * therefore watched by a warning after the write, not enforced at it — which is
 * exactly why a typo'd module number produces a silent false edge rather than a
 * `broken` marker.
 */
export const MODULE_ID_PATTERN = /\bM\d+\b/i;
