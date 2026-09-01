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
  /**
   * The `after` side. `id: null` — reachable only through `toIdOrName:
   * "current"` — is the ONLY signal that this side is the live, not-yet-released
   * state rather than a frozen release, and therefore that the diff is a
   * function of the working tree and does not reproduce. A consumer that keys
   * off `name === 'current'` instead is reading a string a real release can
   * never carry (the name is reserved), but `id` is the field that means it.
   */
  to: { id: number | null; name: string };
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
  /**
   * 0.2.40 — present IFF anything in this response degraded under the response
   * budget. A sentence saying HOW to retry: narrow `entityTypes`, lower `limit`,
   * drop to `summaryOnly`, advance `offset`.
   *
   * The instruction lives ONLY here, at the envelope. An item carries the bare
   * `truncated` flag and nothing else, because the remedy is a property of the
   * CALL, not of the row that happened to be first past the line — duplicating
   * it per item would multiply one instruction by the number of things it
   * applies to and invite them to drift apart.
   */
  truncationHint?: string;
}

/** Light delta-map entry (`summaryOnly: true`) — identifier + op, no `before`/`after`. */
export interface MCPEntityDeltaLight {
  type: EntityTypeFilter;
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
  type: EntityTypeFilter;
  slug: string;
  name: string;
  op: 'create' | 'update' | 'delete';
  /** Omitted for `op: 'create'`, AND when this item degraded under the response budget (then `truncated: true`). */
  before?: EntitySnapshot;
  /** Omitted for `op: 'delete'`, AND when this item degraded under the response budget (then `truncated: true`). */
  after?: EntitySnapshot;
  /**
   * 0.2.40 — present IFF `before`/`after` fell out under the response budget.
   *
   * This is what separates "the entity changed, its payload did not fit" from
   * "the entity did not change" — the latter never appears in `entities[]` at
   * all. Without the marker the two are the same observation, and a brief built
   * on that observation would state a release did less than it did.
   *
   * A consumer may therefore NOT infer `op === 'update'` implies `before` and
   * `after`. Check `truncated` first.
   */
  truncated?: true;
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
   *
   * 0.2.40 — pod presją budżetu odpowiedzi pole ZOSTAJE, ale jest ucięte
   * TEKSTOWO; sygnalizuje to `truncated`.
   */
  content?: string;
  /**
   * Ustawione iff pure move: anchor zmienił pozycję, treść identyczna
   * (po noise-stripping). Move + content change collapse'uje do zwykłego
   * update'u — `content` obecne z tagami, `moved` pominięte.
   */
  moved?: true;
  /**
   * 0.2.40 — present IFF `content` was cut TEXTUALLY by the response budget.
   * The line-diff is then incomplete; continue with a smaller window.
   *
   * Deliberately the OPPOSITE mechanism to `MCPEntityDelta.truncated`, and the
   * asymmetry follows the kind of payload rather than being an inconsistency: a
   * section body is text, and shorter text is still the same kind of data, so it
   * is cut and kept. An entity snapshot is a serialized record, and half of one
   * is not a smaller record — it is malformed data wearing the shape of a
   * record — so it is dropped whole instead.
   */
  truncated?: true;
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
  /**
   * 0.2.40 — present IFF a dimension was cut short by the response budget.
   * Points at `offset` / `limit`.
   *
   * There is deliberately NO per-item `truncated` here, unlike `MCPReleaseDiff`.
   * A row of this snapshot is already identity-only, so there is no heavy half
   * to shed: degradation can only ever be a narrower WINDOW, never a poorer row,
   * and a marker on an item would describe a loss that cannot happen. Absence of
   * a row here means "outside the window" — readable from `total` + `offset` —
   * not "unchanged", which is the diff's problem and the diff's marker.
   */
  truncationHint?: string;
}

export type IncludeFilter = 'pages' | 'entities';
/**
 * An entity type id. 0.2.11: `string`, not a five-literal union.
 *
 * The union was re-inlined verbatim in three places in this file, and every one
 * of them made a type the release layer had captured unrepresentable in the tool
 * output that reports on it.
 */
export type EntityTypeFilter = string;

export interface ProjectionOpts {
  include: IncludeFilter[];
  entityTypes?: EntityTypeFilter[];
}
