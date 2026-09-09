/**
 * 0.2.77 — the wire shape of projection freshness, shared by the server that
 * owns it, the WS event that announces it and the settings card that renders it.
 *
 * It lives in `shared/` rather than next to the registry because three surfaces
 * have to agree on it exactly: a card showing `stale` where the server meant
 * `not_materialized` would tell the user to rebuild something that was never
 * built.
 */

/**
 * The three states are NOT degrees of one scale, and the UI must not render them
 * as such. `not_materialized` means "nothing was ever built here"; `stale` means
 * "something was built and no longer matches the files". They lead to different
 * decisions, which is the whole reason both exist.
 */
export type ProjectionState = 'fresh' | 'stale' | 'not_materialized';

/**
 * `'global'` — the whole projection is unusable. Otherwise the individual
 * artifacts that failed to recompute, in the owner's own key vocabulary
 * (`rootId:path` for M06/M02/M08/M14, the entity type for M29 entities).
 *
 * The owner decides the scope, never the file-watch runtime: M40 reports which
 * REACTION failed and on which artifact, and knows nothing about how many
 * artifacts somebody else's projection divides into.
 */
export type ProjectionScope = 'global' | readonly string[];

/** One row of `GET /_meta/index-status` — one projection of one project. */
export interface ProjectionStatusRow {
  /** Stable identifier, e.g. `m06-sections`. Also the `rebuild` body's key. */
  id: string;
  /** Human label for the settings card. */
  label: string;
  state: ProjectionState;
  /** Present only when `state === 'stale'`. */
  scope?: ProjectionScope;
  /** Epoch ms of the last SUCCESSFUL recompute; null when there has never been one. */
  lastRebuiltAt: number | null;
  /**
   * Whether reads off this projection REFUSE while it is marked.
   *
   * Rendered so the card can say why two rows in the same `stale` state mean
   * different things: M02's frontmatter index and M08's todo index carry the flag
   * but keep answering, because their records hand out a caller-supplied key and
   * navigation targets — never a write address.
   */
  refusesReads: boolean;
}
