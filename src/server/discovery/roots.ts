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
 * 2. **Behaviour follows the root's KIND, not its identity.** 2.1.8: only roots
 *    of kind `pages` are addressable, and every one of them has a section index
 *    (the kind selects `m06-section-indexer`) and belongs to the reference graph
 *    (the kind's `references` flag). There is no "root without a section index"
 *    mode any more.
 *
 * Addressability is the third rule, and it is enforced by construction: the core
 * only ever sees the `kind: pages` roots (`config.roots[]`). The system roots —
 * plans, briefs, patches, entities, releases — are not in this set, so naming
 * one (`rootId: 'plans'`) is the same INVALID_ARGUMENT as an unknown id.
 */

import type { Root } from '../../shared/types.js';
import { KIND_DECLARATIONS, PAGES_KIND, kindSelects, type RootKind } from '../../shared/root-kinds.js';
import { invalidArgument } from './errors.js';

export class RootSet {
  private readonly byId: Map<string, Root>;

  /**
   * `all` — the `kind: pages` roots, in `roots[]` order.
   * `referenceOnly` — 2.1.9: registry roots of other kinds that the reference
   * graph sweeps (`references = yes`, e.g. `skills`, M52 `i5frb6it`). They never
   * become addressable: `require`/`get`/`ids` see only `all`; the gates below
   * read each one's KIND.
   */
  constructor(
    readonly all: readonly Root[],
    private readonly referenceOnly: ReadonlyArray<{ root: Root; kind: RootKind }> = [],
  ) {
    this.byId = new Map(all.map((r) => [r.id, r]));
  }

  /** The reference-only roots whose kind satisfies `test`. */
  private extra(test: (kind: RootKind) => boolean): Root[] {
    return this.referenceOnly.filter((e) => test(e.kind)).map((e) => e.root);
  }

  ids(): string[] {
    return this.all.map((r) => r.id);
  }

  get(rootId: string): Root | undefined {
    return this.byId.get(rootId);
  }

  /** The list every refusal carries — the page roots of this project. */
  private pageRootsList(): string {
    return this.ids().length ? `page roots in this project: ${this.ids().join(', ')}` : 'this project declares no page roots';
  }

  /**
   * Resolves a caller-supplied `rootId`. A missing one is an INVALID_ARGUMENT
   * carrying the list of page roots — never a fallback to the built-in root,
   * which is what made `resolve_page({ path })` answer confidently from the
   * wrong directory. An id that is not a `kind: pages` root — unknown, or a
   * system root such as `plans` — is the same INVALID_ARGUMENT.
   */
  require(rootId: string | undefined, operation: string): Root {
    if (!rootId) {
      const example = this.ids()[0];
      throw invalidArgument(
        `${operation} requires rootId — a page path alone is ambiguous across roots (${this.pageRootsList()})`,
        example
          ? `${operation}({ rootId: "${example}", … }); ${this.pageRootsList()}`
          : `${operation} needs a rootId, but this project declares no page roots`,
      );
    }
    const root = this.byId.get(rootId);
    if (!root) {
      /**
       * 0.2.6 — an unknown ROOT is a bad argument, not a missing page.
       * `PAGE_NOT_FOUND` is reserved for "the root exists, that path does not".
       */
      throw invalidArgument(`unknown rootId '${rootId}' (${this.pageRootsList()})`, this.pageRootsList());
    }
    return root;
  }

  /** Roots that carry a section index — every page root, by its kind. */
  sectionIndexed(): Root[] {
    return [
      ...(kindSelects(PAGES_KIND, 'm06-section-indexer') ? this.all : []),
      ...this.extra((k) => kindSelects(k, 'm06-section-indexer')),
    ];
  }

  /**
   * Roots whose kind selects `m06-anchor-injection` — the roots where a heading
   * without an anchor gets one on the next pass (M06 `9cf6zu0f`).
   */
  anchorInjected(): Root[] {
    return [
      ...(kindSelects(PAGES_KIND, 'm06-anchor-injection') ? this.all : []),
      ...this.extra((k) => kindSelects(k, 'm06-anchor-injection')),
    ];
  }

  /**
   * Roots in the reference graph — every page root, by its kind's `references`
   * flag, then (2.1.9) the reference-only roots whose kind carries it.
   */
  referenceValidated(): Root[] {
    return [
      ...(KIND_DECLARATIONS[PAGES_KIND].flags.references ? this.all : []),
      ...this.extra((k) => KIND_DECLARATIONS[k].flags.references),
    ];
  }
}
