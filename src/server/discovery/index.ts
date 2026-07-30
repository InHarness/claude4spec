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
import type { DiscoveryCore, DiscoveryDeps } from './types.js';

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

export { DiscoveryError, isDiscoveryError, type DiscoveryErrorCode } from './errors.js';
export type * from './types.js';
export { searchableFieldsOf } from './ops/meta.js';
export { hasDeclaredSearchFields } from './search/fields.js';
