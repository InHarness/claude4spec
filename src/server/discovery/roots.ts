/**
 * M39 — page-root gating, in ONE place.
 *
 * Two rules live here and nowhere else:
 *
 * 1. **A page is always `(rootId, relPath)`.** Never a bare path. The same
 *    relative path exists in several roots, so a bare path is ambiguous, and the
 *    old habit of defaulting to `'pages'` turned that ambiguity into a silently
 *    wrong answer. There is no default `rootId` in this module and no
 *    `if (rootId === 'pages')` branch — an architecture test enforces both.
 *
 * 2. **Behaviour follows root PROPERTIES, not root identity.** Sections exist
 *    only where `sectionIndexed`; reference/consistency sweeps run only where
 *    `referenceValidated`. A root without a property is not an error, it is a
 *    root that degrades: `search_pages` still searches it and simply returns
 *    `(rootId, path, line)` hits instead of anchors.
 *
 * Addressability is the third rule, and it is enforced by omission: the core
 * only ever sees `config.roots[]`. Briefs, patches, plans and the entity
 * catalogue are separate artifact mounts, so no parameter of any operation can
 * name them. That is a construction, not a prompt rule.
 */

import type { Root } from '../../shared/types.js';
import { invalidArgument, pageNotFound } from './errors.js';

export type RootProperty = 'sectionIndexed' | 'referenceValidated' | 'releasable';

export class RootSet {
  private readonly byId: Map<string, Root>;

  constructor(readonly all: readonly Root[]) {
    this.byId = new Map(all.map((r) => [r.id, r]));
  }

  ids(): string[] {
    return this.all.map((r) => r.id);
  }

  with(property: RootProperty): Root[] {
    return this.all.filter((r) => r[property]);
  }

  get(rootId: string): Root | undefined {
    return this.byId.get(rootId);
  }

  /**
   * Resolves a caller-supplied `rootId`. A missing one is an INVALID_ARGUMENT
   * carrying the list of roots — never a fallback to the built-in root, which
   * is what made `resolve_page({ path })` answer confidently from the wrong
   * directory.
   */
  require(rootId: string | undefined, operation: string): Root {
    if (!rootId) {
      // The correction names a root that ACTUALLY EXISTS in this project. The
      // old page API filled the gap with the built-in root's name, which is how
      // a missing argument turned into a confident answer from the wrong
      // directory — so an example is only offered when there is a real one.
      const example = this.ids()[0];
      throw invalidArgument(
        `${operation} requires rootId — a page path alone is ambiguous across roots`,
        example
          ? `${operation}({ rootId: "${example}", … }); roots in this project: ${this.ids().join(', ')}`
          : `${operation} needs a rootId, but this project declares no page roots`,
      );
    }
    const root = this.byId.get(rootId);
    if (!root) {
      /**
       * 0.2.6 — an unknown ROOT is a bad argument, not a missing page.
       *
       * `PAGE_NOT_FOUND` is reserved for "the root exists, that path does not",
       * which is the answer that authorizes a caller to stop looking. A typo in
       * `rootId` is a different situation with a different remedy — pick one of
       * these roots — and reporting it as a missing page sent callers hunting
       * for a file when the directory they named never existed.
       */
      throw invalidArgument(
        `unknown rootId '${rootId}'`,
        this.ids().length
          ? `roots in this project: ${this.ids().join(', ')}`
          : 'this project declares no page roots',
      );
    }
    return root;
  }

  /**
   * The roots a section-addressed operation may touch. A root with no section
   * index has no anchors to list, so iterating it would be a guaranteed miss.
   */
  sectionIndexed(): Root[] {
    return this.with('sectionIndexed');
  }

  referenceValidated(): Root[] {
    return this.with('referenceValidated');
  }

  requireSectionIndexed(rootId: string, operation: string): Root {
    const root = this.require(rootId, operation);
    if (!root.sectionIndexed) {
      throw invalidArgument(
        `root '${rootId}' is not section-indexed, so it has no anchors`,
        `use get_page({ rootId: "${rootId}", path }) to read this root's pages; section-indexed roots: ${this.sectionIndexed()
          .map((r) => r.id)
          .join(', ') || 'none'}`,
      );
    }
    return root;
  }
}
