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
  | 'INDEX_NOT_MATERIALIZED';

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
