/**
 * Slug selection for the AC `verifies` picker, kept separate from the panel so
 * it can be tested directly — there is no React Testing Library in this repo,
 * so anything only reachable through rendering is effectively untested.
 *
 * Three rules earn their own home here, each of which was a real defect:
 *  - a type referenced by the AC gets a group even when no module serves it,
 *    or the reference becomes invisible AND unremovable;
 *  - linked slugs survive filtering, or the picker loses the badge it resolves
 *    through `items` (a dangling ⚠ reference reads as healthy mid-search);
 *  - a query only ever touches its own group.
 */

export interface VerifyGroupInput {
  /** Entity types with an active module, in display order. */
  moduleTypes: string[];
  /** Linked slugs per type, from the AC's current draft. */
  selected: Record<string, string[]>;
  /** Candidate slugs per type — absent until that group has been opened. */
  fetchedByType: Record<string, string[]>;
  /** Search text per type; a type with no entry is unfiltered. */
  queries: Record<string, string>;
}

/**
 * The types needing a row: active modules first, then any referenced type no
 * module serves (inactive or unknown), so nothing is orphaned.
 */
export function verifyGroupTypes({
  moduleTypes,
  selected,
}: Pick<VerifyGroupInput, 'moduleTypes' | 'selected'>): string[] {
  const known = new Set(moduleTypes);
  return [...moduleTypes, ...Object.keys(selected).filter((t) => !known.has(t))];
}

/** The ordered item ids for one group: matching candidates, every linked slug, then the literal. */
export function verifyGroupItems(type: string, input: VerifyGroupInput): string[] {
  const query = (input.queries[type] ?? '').trim();
  const q = query.toLowerCase();
  const linked = input.selected[type] ?? [];
  const fetched = input.fetchedByType[type] ?? [];

  const matching = q ? fetched.filter((s) => s.toLowerCase().includes(q)) : fetched;
  const known = Array.from(new Set([...matching, ...linked]));
  // A query matching nothing is offered verbatim: an AC may verify an entity
  // that does not exist yet, which the candidate list alone cannot express.
  const literal = query && !known.some((s) => s.toLowerCase() === q) ? [query] : [];
  return [...known, ...literal];
}
