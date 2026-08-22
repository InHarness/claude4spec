/**
 * Identity of the type this package contributes.
 *
 * REACT-FREE on purpose, exactly as the spreadsheets envelope's note explains:
 * `capabilities/commands.ts` reads the popover kind from here and is reachable
 * from `src/index.ts`, the entry the host's NODE loader imports. Pulling two
 * string literals out of a `.tsx` would put React, `react/jsx-runtime` and
 * `lucide-react` on the server's plugin-load path — evaluated on every boot, and
 * a hard `PLUGIN_IMPORT_FAILED` (with the type silently absent) in any install
 * that prunes UI dependencies from a server image.
 */

export const CODE_SNIPPET_TYPE = 'code-snippet';

/** The projection table the host derives from `data.schema`. */
export const CODE_SNIPPET_TABLE = 'code_snippet';

/**
 * The prefix WITHOUT `/api`, matching every other type.
 *
 * The generated router is mounted onto a router that already sits at `/api`
 * (`project-context.ts`: `router.use(module.pathPrefix, generatedCrudRouter(…))`),
 * so the served path is `/api/code-snippets` and declaring it in full here would
 * produce `/api/api/code-snippets` — a type whose every route 404s while the
 * declaration reads as though it were right.
 */
export const CODE_SNIPPET_PATH_PREFIX = '/code-snippets';
export const CODE_SNIPPET_LABEL = 'Code snippet';
export const CODE_SNIPPET_LABEL_PLURAL = 'Code snippets';

/**
 * The type is HIDDEN — the frontend module declares no `sidebarTab`, no `routes`
 * and no `detailPanel` — so this never orders anything in the UI. It exists
 * because `EntityModuleManifest` requires it, and it still orders the type in
 * catalogues, release snapshots and diffs. Last, after `spreadsheet`'s 100.
 */
export const CODE_SNIPPET_DISPLAY_ORDER = 110;

/** The popover kind `/code-snippet` dispatches. See `capabilities/commands.ts`. */
export const CODE_SNIPPET_POPOVER_KIND = `${CODE_SNIPPET_TYPE}-create`;

/**
 * The promotion threshold, in lines.
 *
 * Not enforced anywhere — it CANNOT be, because half the rule ("is this an
 * example of a form?") is a judgement no validator makes. It is stated here so
 * the system prompt and any future authoring affordance quote one number rather
 * than two. Measured against the corpus that motivated the type: 216 fences,
 * median 8 lines, 44 over this threshold, ~16 over it AND an example of a form.
 */
export const PROMOTION_MIN_LINES = 20;

/**
 * How many lines a snippet may render before the card collapses it.
 *
 * The brief names a "collapse threshold" without a number. 30 is chosen against
 * the same measurement as the threshold above: the promotion floor is 20 lines,
 * so a collapsing card must sit comfortably ABOVE it — collapsing the shortest
 * legal snippet by default would make the affordance feel broken. The fullscreen
 * overlay ignores this entirely and always shows everything.
 */
export const COLLAPSE_LINES = 30;

/** The default `language`, and what an empty string normalizes to. */
export const DEFAULT_LANGUAGE = 'text';

/**
 * The closed alias table, applied by the host AFTER lower-casing (see
 * `ScalarNode.normalize`). ONE definition, read by the schema declaration, by
 * the popover's live preview and by the tests.
 *
 * Why a free string with an alias table and NOT an enum: an enum would make
 * every new language a `payloadUpgrades` step. The motivation is a measurement
 * of the corpus — `typescript` 60× against `ts` 31×, `sh` 12× against `bash` 2×,
 * and 39 fences (18%) carrying no tag at all — so the spread is between
 * SPELLINGS of the same language, which is what an alias table is for.
 *
 * A value outside the table is stored lower-cased and NEVER refused. If the
 * highlighter does not know it, the card degrades to plaintext. Colouring is a
 * convenience, not a condition of correctness.
 */
export const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  '': DEFAULT_LANGUAGE,
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
};
