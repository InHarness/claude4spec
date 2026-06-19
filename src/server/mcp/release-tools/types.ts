/**
 * Self-contained MCP projection types for `release-tools`.
 *
 * Why self-contained: a brief generated for `release_diff(N-1, N)` must remain
 * interpretable after HEAD moves to N+2. Raw `RawDelta` carries `line_diff`
 * (UI render-only) and references current-state via slug — both fail for the
 * historical reader. `MCPReleaseDiff` therefore carries full `before/after`
 * snapshots per entity and per modified section.
 */

/** Per-type entity snapshot shape decided by plugin's serializer.snapshot(). */
export type EntitySnapshot = Record<string, unknown>;

export interface MCPReleaseDiff {
  from: { id: number; name: string } | null;
  to: { id: number; name: string };
  /**
   * Totals AFTER include/entityTypes filters, BEFORE limit/offset. Keys stay in
   * lock-step with `include` (mirrors `MCPSpecSnapshot.total`). Always present so
   * a paginating consumer — or the brief-author probe-map (`summaryOnly: true`) —
   * knows the full cardinality of each filtered dimension.
   */
  total?: { entities?: number; pages?: number };
  /**
   * Heavy variant (`summaryOnly !== true`): full `MCPEntityDelta` with
   * `before`/`after`, windowed by `limit`/`offset`.
   * Light variant (`summaryOnly === true`): `MCPEntityDeltaLight` identifiers
   * only (full list, window ignored).
   */
  entities?: MCPEntityDelta[] | MCPEntityDeltaLight[];
  pages?: MCPPageDelta[] | MCPPageDeltaLight[];
}

/** Light delta-map entry (`summaryOnly: true`) — identifier + op, no `before`/`after`. */
export interface MCPEntityDeltaLight {
  type: 'endpoint' | 'dto' | 'database-table' | 'ui-view' | 'ac';
  slug: string;
  name: string;
  op: 'create' | 'update' | 'delete';
}

/** Light delta-map entry (`summaryOnly: true`) — path + op, no `sections`/`content`. */
export interface MCPPageDeltaLight {
  path: string;
  op: 'create' | 'update' | 'delete';
}

export interface MCPEntityDelta {
  type: 'endpoint' | 'dto' | 'database-table' | 'ui-view' | 'ac';
  slug: string;
  name: string;
  op: 'create' | 'update' | 'delete';
  before?: EntitySnapshot;
  after?: EntitySnapshot;
}

export interface MCPPageDelta {
  path: string;
  op: 'create' | 'update' | 'delete';
  sections: MCPSectionDelta[];
  frontmatter?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
  xmlRefs?: { before?: string[]; after?: string[] };
}

export interface MCPSectionDelta {
  anchor: string;
  /**
   * Current heading sekcji (after-side dla create/update; before-side dla
   * delete; dla pure-move = current). Jeśli sam tekst headingu się zmienił,
   * zmiana pojawia się jak każda inna linia w `content` (z tagami
   * `<before_change>` / `<after_change>` przy linijce nagłówka).
   */
  heading: string;
  /**
   * Raw markdown sekcji z inline tagami line-diff'u
   * (`<before_change>old</before_change>` przy linijkach usuniętych,
   * `<after_change>new</after_change>` przy dodanych; literalne wystąpienia
   * tych tagów w treści są escape'owane jako encje XML). Pomijane wyłącznie
   * dla pure-move'a; w pozostałych przypadkach obecne.
   */
  content?: string;
  /**
   * Ustawione iff pure move: anchor zmienił pozycję, treść identyczna
   * (po noise-stripping). Move + content change collapse'uje do zwykłego
   * update'u — `content` obecne z tagami, `moved` pominięte.
   */
  moved?: true;
}

export interface MCPSpecSnapshot {
  release: {
    id: number;
    name: string;
    description: string;
    created_by: string;
    created_at: string;
  };
  /**
   * Totals BEFORE limit/offset, AFTER include/entityTypes filters. Keys stay in
   * lock-step with `include`: `entities`/`pages` key omitted when its dimension
   * is excluded. Lets a paginating consumer know how many items exist in total.
   */
  total: { entities?: number; pages?: number };
  entities?: { type: string; slug: string; name: string }[];
  pages?: { path: string }[];
}

export type IncludeFilter = 'pages' | 'entities';
export type EntityTypeFilter = 'endpoint' | 'dto' | 'database-table' | 'ui-view' | 'ac';

export interface ProjectionOpts {
  include: IncludeFilter[];
  entityTypes?: EntityTypeFilter[];
}
