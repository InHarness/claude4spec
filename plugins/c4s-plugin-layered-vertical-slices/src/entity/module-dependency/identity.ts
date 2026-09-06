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

/*
 * NO PATTERN FOR THE MODULE IDENTIFIER, and no validator behind `dependent` /
 * `provider` either.
 *
 * The two fields name an OPEN set of modules, which neither `enum` nor
 * `maxLength` describes and which the host's named-validator dictionary has no
 * entry for. So a typo'd module number is not an error the write path can
 * refuse — it is a silent false edge, and the reader of these edges is the agent
 * working under this style, guided by `SKILL.md`, not a check in the host.
 *
 * That is deliberate rather than a gap waiting to be filled. `check_consistency`
 * is generic: it belongs to every project regardless of which types, and which
 * writing style, that project installed, so it is not the place to teach the
 * conventions of one style.
 */
