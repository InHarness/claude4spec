/**
 * M39 — the discovery core's error catalogue.
 *
 * "Navigation in an error is a dimension, not a courtesy." An agent that gets
 * `SECTION_NOT_FOUND` and nothing else has been told to guess; the session that
 * motivated this module burned thirteen turns guessing paths. So the factories
 * below do not accept a bare message: every `*_NOT_FOUND` takes the alternatives
 * that DO exist, and every `INVALID_ARGUMENT` takes the call that would have
 * worked. The type system is what keeps that promise — you cannot construct a
 * navigation-free error through this file.
 *
 * Transports MAP these codes onto their own surface (CLI exit codes, MCP
 * `tool_result.error`); they never define their own.
 */

export type DiscoveryErrorCode =
  | 'ENTITY_NOT_FOUND'
  | 'SECTION_NOT_FOUND'
  | 'PAGE_NOT_FOUND'
  | 'INVALID_TYPE'
  | 'INVALID_ARGUMENT'
  | 'AMBIGUOUS_ENTITY'
  | 'AMBIGUOUS_PAGE'
  | 'INDEX_NOT_MATERIALIZED'
  | 'INDEX_STALE'
  | 'SEARCH_BUDGET_EXCEEDED';

export class DiscoveryError extends Error {
  readonly name = 'DiscoveryError';
  constructor(
    readonly code: DiscoveryErrorCode,
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }

  /** The wire shape every transport re-frames. */
  toJSON(): { error: string; code: DiscoveryErrorCode; message: string; hint: string } {
    return { error: this.message, code: this.code, message: this.message, hint: this.hint };
  }
}

export function isDiscoveryError(err: unknown): err is DiscoveryError {
  return err instanceof DiscoveryError;
}

/**
 * Renders alternatives without letting a long list become the whole payload —
 * a hint that costs more tokens than the answer is its own kind of failure.
 */
function sample(values: readonly string[], max = 12): string {
  if (!values.length) return 'none';
  const head = values.slice(0, max).join(', ');
  return values.length > max ? `${head}, … (${values.length} total)` : head;
}

export function entityNotFound(
  type: string,
  slug: string,
  alternatives: readonly string[],
): DiscoveryError {
  return new DiscoveryError(
    'ENTITY_NOT_FOUND',
    `no ${type} with slug '${slug}'`,
    `known ${type} slugs: ${sample(alternatives)}. Use resolve_identity to match a partial name.`,
  );
}

export function sectionNotFound(anchor: string, alternatives: readonly string[]): DiscoveryError {
  return new DiscoveryError(
    'SECTION_NOT_FOUND',
    `no section with anchor '${anchor}'`,
    alternatives.length
      ? `nearby anchors: ${sample(alternatives)}. Use search_pages to find a section by text — a hit carries the anchor.`
      : 'Use search_pages to find a section by text — a hit carries the anchor.',
  );
}

export function pageNotFound(
  rootId: string,
  pagePath: string,
  rootIds: readonly string[],
): DiscoveryError {
  return new DiscoveryError(
    'PAGE_NOT_FOUND',
    `no page '${pagePath}' in root '${rootId}'`,
    `roots in this project: ${sample(rootIds)}. Use list_pages({ rootId }) to see what a root contains.`,
  );
}

export function invalidType(type: string, activeTypes: readonly string[]): DiscoveryError {
  return new DiscoveryError(
    'INVALID_TYPE',
    `entity type '${type}' is unknown or not active in this project`,
    `active types: ${sample(activeTypes)}.`,
  );
}

/**
 * `correction` is the call that WOULD have worked — not a restatement of the
 * refusal. "rootId is required" is a refusal; `get_page({ rootId: "pages", path })`
 * is navigation.
 */
export function invalidArgument(message: string, correction: string): DiscoveryError {
  return new DiscoveryError('INVALID_ARGUMENT', message, correction);
}

export function ambiguousEntity(slug: string, candidates: readonly string[]): DiscoveryError {
  return new DiscoveryError(
    'AMBIGUOUS_ENTITY',
    `slug '${slug}' exists for more than one type`,
    `candidates: ${sample(candidates)}. Pass an explicit type.`,
  );
}

export function ambiguousPage(pagePath: string, rootIds: readonly string[]): DiscoveryError {
  return new DiscoveryError(
    'AMBIGUOUS_PAGE',
    `path '${pagePath}' exists in more than one root`,
    `it exists in: ${sample(rootIds)}. Pass rootId to disambiguate.`,
  );
}

/**
 * The db slot has no file. The hint deliberately does NOT suggest deleting or
 * rebuilding the index: no slot file also means no runtime state, so "just
 * rebuild it" would be advice to destroy a project's context on a hunch.
 */
export function indexNotMaterialized(): DiscoveryError {
  return new DiscoveryError(
    'INDEX_NOT_MATERIALIZED',
    'no index has been built for this project yet',
    'Run `npx @inharness-ai/claude4spec` in the project directory once — it builds the index. Do not delete anything to fix this.',
  );
}

/**
 * 0.2.77 (M39) — the projection EXISTS but has been marked as no longer
 * describing the state of the files.
 *
 * The sibling one line up, `INDEX_NOT_MATERIALIZED`, is a different answer to a
 * different question, and that difference is what earned this a code of its own:
 * `INDEX_NOT_MATERIALIZED` means "there is no projection for this project — give
 * up", `INDEX_STALE` means "there is one, and it is out of date — rebuild and
 * retry". The two send the caller in opposite directions.
 *
 * The refusal is FAIL-CLOSED and applies to every projection owner: a read that
 * hands out coordinates or identities the caller then WRITES against is refused
 * rather than answered from pre-recompute state. A quiet answer off stale data is
 * content corruption, not a stale view.
 *
 * `message` carries the marking's SCOPE (global, or the artifacts marked) because
 * that is what tells the caller whether anything else still works; `hint` carries
 * the rebuild path, because a refusal with no way out is just a dead end.
 */
export function indexStale(
  projection: string,
  scope: 'global' | readonly string[],
): DiscoveryError {
  const where =
    scope === 'global'
      ? 'the whole projection is marked'
      : `marked artifacts: ${sample(scope)}`;
  return new DiscoveryError(
    'INDEX_STALE',
    `projection '${projection}' is marked stale and no longer describes the files on disk (${where})`,
    `Rebuild it — POST /api/projects/:id/_meta/index-status/rebuild with { "projection": "${projection}" }, ` +
      'or open Settings → Index status and press Rebuild — then retry. ' +
      'get_page still answers with content and a valid expectedHash while this projection refuses.',
  );
}

/**
 * 0.2.95 (M39) — the scan ran out of TIME, and the two codes it is deliberately
 * NOT are the whole point of it existing.
 *
 * Not `INVALID_ARGUMENT`: the argument was valid, and the very same pattern
 * completes over a narrower scope. Answering with an argument error would send
 * the caller to correct the one thing that was right, and it would learn the
 * wrong lesson about its own pattern. Not a hang either — the loop checks
 * between match units, so the operation always answers something.
 *
 * And not a partial result with `truncated: true`, which was the tempting third
 * option: a caller reads a short list as "that is all there is", which is the
 * silent false negative the rest of this catalogue exists to prevent.
 *
 * `message` carries the narrowing VALVES because narrowing the scope is the only
 * action that changes the outcome; `hint` carries the call that would have
 * worked, like every other refusal here.
 */
export function searchBudgetExceeded(
  operation: 'search_pages' | 'search_entities',
  budgetMs: number,
): DiscoveryError {
  const { valves, retry } = SEARCH_NARROWING[operation];
  return new DiscoveryError(
    'SEARCH_BUDGET_EXCEEDED',
    `${operation} spent its ${budgetMs} ms scan budget and stopped between match units — ` +
      `the pattern is valid, the SCOPE is too wide. Narrow it with ${valves}.`,
    retry,
  );
}

const SEARCH_NARROWING = {
  search_pages: {
    valves: '--root-id (one root at a time) / --path-include (a path prefix)',
    retry:
      // No literal root id here: the core has no default root and must not name
      // one even as an example — `list_pages` is where a caller learns its ids.
      'search_pages({ regex: "<the same pattern>", rootId: "<one of your roots>", pathInclude: "^modules/" }) — ' +
      'or mode: "count" first, which sizes the answer without rendering it.',
  },
  search_entities: {
    valves: '--type (one type at a time) / --fields (only the paths worth scanning)',
    retry:
      'search_entities({ type: "<one type>", fields: ["title"], regex: "<the same pattern>" }) — ' +
      'or mode: "count" first, which sizes the answer without rendering it.',
  },
} as const;
