/**
 * M39 — Discovery Core.
 *
 * Fourteen read-only operations, one semantics. Everything that reads the
 * specification — the `c4s` CLI, the external stdio MCP server, the in-process
 * tool servers, the built-in chat agent — is a THIN TRANSPORT over this: it
 * maps names and a protocol, it does not define behaviour.
 *
 * Read-only from a hard boundary. There is no mutating operation here and no
 * path to one; writes stay in M13 (entities) and M02 (pages). An external agent
 * looking for a write tool finds none, by construction rather than by policy.
 *
 * Operations are grouped by subject rather than one file per operation —
 * `list_sections` and `get_section` share the same row shape and the same root
 * gate, and splitting them would mean exporting that shared machinery just to
 * re-import it next door.
 */

import { checkConsistency } from './ops/consistency.js';
import { getEntities, listEntities, resolveIdentity, searchEntities } from './ops/entities.js';
import { describeTypes, overview } from './ops/meta.js';
import { getPage, listPages } from './ops/pages.js';
import { findReferences } from './ops/references.js';
import { getSection, listSections } from './ops/sections.js';
import { listTags } from './ops/tags.js';
import { PageSource } from './page-source.js';
import { RootSet } from './roots.js';
import { searchPages } from './search/page-search.js';
import { MAX_SLUGS_PER_CALL } from './budget.js';
import { MAX_LIMIT, type Page } from './pagination.js';
import type {
  DiscoveryCore,
  DiscoveryDeps,
  GetEntitiesInput,
  GetEntitiesResult,
  ListEntitiesInput,
  ListTagsInput,
  SerializedMeta,
  TagListItem,
} from './types.js';

export function createDiscoveryCore(deps: DiscoveryDeps): DiscoveryCore {
  const roots = new RootSet(deps.roots);
  const pages = new PageSource(deps.projectDir, deps.roots);

  return {
    overview: () => overview(deps, pages, roots),
    describeTypes: (input) => describeTypes(deps, input),
    listPages: (input) => listPages(deps.db, pages, roots, input),
    listSections: (input) => listSections(deps.db, pages, roots, input),
    getSection: (input) => getSection(deps.db, pages, roots, deps.reader, deps.serialization, input),
    getPage: (input) => getPage(pages, roots, input),
    searchPages: (input) => searchPages(deps.db, pages, roots, input),
    searchEntities: (input) => searchEntities(deps, input),
    listEntities: (input) => listEntities(deps, input),
    getEntities: (input) => getEntities(deps, input),
    listTags: (input) => listTags(deps.db, deps.reader, input),
    findReferences: (input) => findReferences(deps, pages, roots, input),
    checkConsistency: (input) => checkConsistency(deps, pages, roots, input),
    resolveIdentity: (input) => resolveIdentity(deps, input),
  };
}

/**
 * Exhaustive reads for HOST-SIDE composition.
 *
 * The paginated, budgeted operations above are shaped for an agent: a bounded
 * page and a signal that more exists. Some consumers are not agents — a page
 * renderer expanding `<element_list slugs="…"/>`, a CLI command piping JSON, a
 * tool whose published contract is "all tags". For those, a cap is not a
 * safeguard, it is silent data loss: the renderer drops entities off a page and
 * the CLI prints a complete-looking list that is missing rows.
 *
 * These helpers exhaust the operation through its own public contract, honouring
 * `hasMore` rather than passing an ambitious `limit` and hoping. They are the
 * ONLY sanctioned way to read past a page boundary, and each caller has to
 * choose one deliberately.
 */

/** Safety stop: a page loop that never reports `hasMore: false` is a bug, not a big project. */
const MAX_PAGES = 1000;

export function collectAll<T>(fetchPage: (offset: number) => Page<T>): T[] {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = fetchPage(out.length);
    out.push(...result.items);
    if (!result.hasMore || result.items.length === 0) return out;
  }
  return out;
}

/** Every entity of a type (optionally tag-filtered), no page boundary. */
export function listEntitiesAll(
  core: DiscoveryCore,
  input: Omit<ListEntitiesInput, 'mode' | 'limit' | 'offset'>,
): Array<{ slug: string; data: unknown } & SerializedMeta> {
  return collectAll((offset) => {
    const page = core.listEntities({ ...input, mode: 'items', limit: MAX_LIMIT, offset });
    if (page.mode !== 'items') return { items: [], total: 0, hasMore: false };
    return page;
  });
}

/** Every tag, no page boundary. */
export function listTagsAll(core: DiscoveryCore, input: Omit<ListTagsInput, 'limit' | 'offset'> = {}): TagListItem[] {
  return collectAll((offset) => core.listTags({ ...input, limit: MAX_LIMIT, offset }));
}

/**
 * Any number of slugs, in the order asked for.
 *
 * `get_entities` caps its slug list and budgets its response on purpose — that
 * is the contract an agent gets. A renderer asking for the 51 slugs an author
 * literally wrote on the page is not overreaching, so it batches instead of
 * being refused.
 */
export function getEntitiesAll(core: DiscoveryCore, input: GetEntitiesInput): GetEntitiesResult['results'] {
  const out: GetEntitiesResult['results'] = [];
  for (let i = 0; i < input.slugs.length; i += MAX_SLUGS_PER_CALL) {
    out.push(...core.getEntities({ ...input, slugs: input.slugs.slice(i, i + MAX_SLUGS_PER_CALL) }).results);
  }
  return out;
}

export { DiscoveryError, isDiscoveryError, type DiscoveryErrorCode } from './errors.js';
export type * from './types.js';
export { hasDeclaredSearchFields } from './search/fields.js';
export { MAX_SLUGS_PER_CALL } from './budget.js';
export { MAX_LIMIT } from './pagination.js';
