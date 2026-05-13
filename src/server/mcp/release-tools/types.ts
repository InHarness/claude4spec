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
  entities?: MCPEntityDelta[];
  pages?: MCPPageDelta[];
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
  entities?: { type: string; slug: string; name: string }[];
  pages?: { path: string }[];
}

export type IncludeFilter = 'pages' | 'entities';
export type EntityTypeFilter = 'endpoint' | 'dto' | 'database-table' | 'ui-view' | 'ac';

export interface ProjectionOpts {
  include: IncludeFilter[];
  entityTypes?: EntityTypeFilter[];
}
