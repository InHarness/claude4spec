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
 * `list_sections` and `get_sections` share the same row shape and the same root
 * gate, and splitting them would mean exporting that shared machinery just to
 * re-import it next door.
 */

import { collectionOverview, collectionWindow } from './ops/collections.js';
import { checkConsistency } from './ops/consistency.js';
import { getEntities, listEntities, resolveIdentity, searchEntities } from './ops/entities.js';
import { describeTypes, overview } from './ops/meta.js';
import { getPage, listPages } from './ops/pages.js';
import { findReferences } from './ops/references.js';
import { getSections, listSections } from './ops/sections.js';
import { listTags } from './ops/tags.js';
import { PageSource } from './page-source.js';
import { RootSet } from './roots.js';
import { searchPages } from './search/page-search.js';
import { MAX_SLUGS_PER_CALL } from './budget.js';
import { MAX_LIMIT, type Page } from './pagination.js';
import type {
  DiscoveryCore,
  DiscoveryDeps,
  FindReferencesInput,
  GetEntitiesInput,
  GetEntitiesResult,
  ListEntitiesInput,
  ListTagsInput,
  ReferenceHit,
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
    getSections: (input) => getSections(deps.db, pages, roots, deps.reader, deps.serialization, input),
    getPage: (input) => getPage(pages, roots, input),
    searchPages: (input) => searchPages(deps.db, pages, roots, input),
    searchEntities: (input) => searchEntities(deps, input),
    listEntities: (input) => listEntities(deps, input),
    getEntities: (input) => getEntities(deps, input),
    listTags: (input) => listTags(deps.db, deps.reader, input),
    findReferences: (input) => findReferences(deps, pages, roots, input),
    checkConsistency: (input) => checkConsistency(deps, pages, roots, input),
    resolveIdentity: (input) => resolveIdentity(deps, input),
    collectionOverview: (input) => collectionOverview(deps, input),
    collectionWindow: (input) => collectionWindow(deps, input),
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
    // Unreachable — `mode: 'items'` was just asked for. Shaped as a full `Page`
    // so the exhaustive sweep below cannot mistake it for a budget cut.
    if (page.mode !== 'items') return { items: [], total: 0, hasMore: false, truncated: false };
    return page;
  });
}

/**
 * Every reference to a target, no page boundary.
 *
 * `find_references` paginates for an agent, which is right: a tool answer has to
 * be bounded. A SWEEP does not have the same shape — its whole purpose is
 * "is anything still pointing at this before I rename or delete it", and a
 * capped answer to that question is a wrong answer that looks like a right one.
 * `c4s find-references` was unbounded before 0.2.6 routed it through the core;
 * this is how it stays unbounded without the core growing an unbounded mode.
 */
export async function findReferencesAll(
  core: DiscoveryCore,
  /** `limit`/`offset` on the way in are ignored — this helper owns the paging. */
  input: FindReferencesInput,
): Promise<ReferenceHit[]> {
  const { references } = await findReferencesAllPaged(core, input);
  return references;
}

/**
 * The same sweep, reporting whether it actually reached the end.
 *
 * `MAX_PAGES` is a runaway guard, not a contract — but a caller that wraps this
 * in an envelope has to be able to tell "exhausted" from "gave up", or it ends
 * up claiming `hasMore: false` on a truncated sweep. For a command whose whole
 * purpose is "is anything still pointing at this before I rename or delete it",
 * a false "that was all of them" is worse than no claim at all.
 */
export async function findReferencesAllPaged(
  core: DiscoveryCore,
  input: FindReferencesInput,
): Promise<{ references: ReferenceHit[]; exhausted: boolean }> {
  const out: ReferenceHit[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await core.findReferences({ ...input, limit: MAX_LIMIT, offset: out.length });
    out.push(...result.references);
    if (!result.hasMore || result.references.length === 0) {
      return { references: out, exhausted: true };
    }
  }
  return { references: out, exhausted: false };
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
  /**
   * 0.2.6 — re-ask for anything the batch could not afford, ONE SLUG AT A TIME.
   *
   * The operation degrades past its response budget to `entity: null` +
   * `truncated: true` rather than dropping the row. That is right for an agent,
   * which can retry with a smaller subset — but this helper exists precisely so
   * a HOST-side caller (a page renderer) does not have to, and a caller that
   * does not know about the flag reads `entity: null` as "no such entity" and
   * renders an existing entity as missing.
   *
   * A single-slug call cannot come back degraded: the first item is never
   * demoted to meta-only, which is exactly the guarantee that makes this retry
   * terminate rather than loop.
   */
  for (let i = 0; i < out.length; i++) {
    const row = out[i]!;
    if (row.truncated !== true) continue;
    const [retried] = core.getEntities({ ...input, slugs: [row.slug] }).results;
    if (retried) out[i] = retried;
  }
  return out;
}

export { DiscoveryError, isDiscoveryError, type DiscoveryErrorCode } from './errors.js';
export type * from './types.js';
export { MAX_ANCHORS_PER_CALL, MAX_SLUGS_PER_CALL } from './budget.js';
export { MAX_WINDOW_CELLS } from './ops/collections.js';
export { MAX_LIMIT } from './pagination.js';
