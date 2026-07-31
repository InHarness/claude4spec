/**
 * EntityModule manifest types shared between server and client.
 *
 * Server-only slots (serializer, services, mcpServer, routes, systemPrompt)
 * live in src/server/core/plugin-host/types.ts. Client-only slots (React
 * components, RouteTreeFragment, editor extensions) live in
 * src/client/core/plugin-host/types.ts. The split prevents bundlers from
 * pulling better-sqlite3/express into the client bundle.
 */

/**
 * A table carrying N rows per entity, owned by the type that declares it
 * (spreadsheet cells, an endpoint↔dto junction). The host clears and reads it
 * generically; only the owning type knows what the rows MEAN.
 */
export interface CompositionDerivedTable {
  /** Table name. Must be prefixed with the declaring type's slug. */
  table: string;
  /** Column holding the owning entity's identity (FK to the main table). */
  bindingColumn: string;
}

/**
 * A HOST-OWNED table shared between types (today: `entity_tag`). Because rows
 * of several types coexist in it, a scope predicate is MANDATORY — without one
 * the host cannot clear this type's rows without clearing everyone else's.
 */
export interface CompositionSharedTable {
  table: string;
  /** SQL boolean expression isolating THIS type's rows, e.g. `entity_type = 'ac'`. */
  scopePredicate: string;
}

/**
 * 0.2.4 — how an entity is COMPOSED out of tables, declared by the envelope so
 * the host never has to guess.
 *
 * Before this, identity carried a single `table` field and every operation that
 * needed more (clearing junctions, scoping a shared table, counting) either
 * hardcoded the answer or asked the module for raw SQL to execute. The
 * descriptor replaces both: the host derives clearing, rebuilding, counting and
 * reading from it, and executes no envelope-supplied SQL.
 *
 * INVARIANT OF PROJECTION: every non-surrogate column of every table named here
 * must be reproducible from the entity files. Dropping the index and rebuilding
 * from `entitiesDir` yields value-identical rows, except the local `id` rowid —
 * the only permitted exception, and one no identity or ordering may rest on
 * (the PK is the slug). `created_at`/`updated_at` are NOT an exception.
 *
 * What it deliberately does NOT cover: `section_entity_link` (derived from
 * markdown, owned by the M06 section indexer), the M17 baseline
 * (`entity_version` / `file_version` / `spec_release`), and runtime state
 * tables that are not reproducible from files.
 */
export interface EntityComposition {
  /** One row per entity, keyed by slug. */
  mainTable: string;
  /** Name of the column on `mainTable` carrying the slug. */
  identityColumn: string;
  derivedTables?: CompositionDerivedTable[];
  sharedTables?: CompositionSharedTable[];
}

export interface EntityModuleManifest {
  /** Stable type discriminator, kebab-case. 1:1 with XML tag attribute. */
  type: string;

  /**
   * SQLite table name; differs from `type` when type contains a hyphen.
   *
   * @deprecated 0.2.4 — superseded by {@link EntityModuleManifest.composition}.
   * Retained as the fallback: a manifest without a descriptor gets an
   * equivalent one composed from this field plus `backend.auxTables`.
   */
  table: string;

  /**
   * 0.2.4 — the composition descriptor. Optional: when absent the host
   * synthesizes an equivalent one from `table` + `backend.auxTables`, so this
   * is an ADDITIVE change and `HOST_API_VERSION` does not move.
   *
   * Never read this slot directly — go through `compositionOf(module)` from
   * `./composition.js`, which returns the normalized descriptor whether the
   * type declared one or not.
   */
  composition?: EntityComposition;

  /** Singular human label, e.g. "Endpoint". */
  label: string;

  /** Plural human label, e.g. "Endpoints" — used in sidebar tabs and prose. */
  labelPlural: string;

  /** Sidebar / display ordering hint (lower = earlier). */
  displayOrder: number;

  /** Derive a slug from a CreateInput payload. Stable, idempotent. */
  slugFrom: (data: unknown) => string;

  /**
   * URL prefix for the plugin's REST routes and client navigation, e.g.
   * "/endpoints" or "/database-tables". Used by both server `mount*Routes`
   * helpers and client `openEntityRoute()` to avoid hardcoded paths in
   * cross-cutting code.
   */
  pathPrefix: string;

  /**
   * 0.2.2 — entity types that must be restored/indexed BEFORE this one, declared
   * by the module that knows the dependency rather than inferred by the host.
   *
   * Restore and index order used to be two hardcoded, silently divergent arrays
   * (`release.ts` listed four types and omitted `ac`/`design-system`/`diagram`;
   * `entity-indexer.ts` listed all seven in a different order). Both now consume
   * `topoSortModules()` over this hint, so "DTO before Endpoint" is the RESULT of
   * `endpoint` declaring `dependsOn: ['dto']` — not host knowledge about a
   * specific pair. A type contributed by a plugin can therefore express an
   * ordering constraint the host has never heard of.
   *
   * Unknown or inactive types in the list are ignored (a soft hint, not a
   * referential-integrity constraint): deactivating `design-system` must not
   * strand `ui-view`.
   */
  dependsOn?: string[];
}

/**
 * View kinds referenced by L9 serializers and L8 NodeViews. Mirrored on the
 * server in src/server/serialization/types.ts (kept in sync manually — this
 * is the canonical list).
 */
export type ViewKind =
  | 'inline_mention'
  | 'single_element'
  | 'element_list_item'
  | 'tagged_list_item'
  | 'detail';

/**
 * SystemPromptContribution — slot consumed by buildSystemPrompt (M05).
 * Server-only at runtime, but the shape is shared so plugins can declare it
 * uniformly. Plugins set this as part of their backend manifest.
 */
export interface SystemPromptContribution {
  /** Plural noun for role description, e.g. "Endpoints". */
  roleNoun: string;

  /**
   * Count statistic injection point.
   *
   * @deprecated 0.2.4 — OPTIONAL and IGNORED. `sqlQuery` is NOT executed; the
   * host counts through `RawEntityReader.count(type)` and labels the result
   * with `labelPlural` from the manifest. This slot was the ONLY place a module
   * handed the host raw SQL to execute, and that surface is now closed. It
   * survives purely as a deprecation window and is removed in the next Host API
   * major.
   *
   * Two consequences of the switch, both intended:
   *   - a type whose query carried a predicate loses it (AC counted only
   *     `status='active'`; the sidebar never did, so the agent and the user now
   *     see the same number);
   *   - labels with spaces or parentheses no longer reach the `<project>` block,
   *     where they produced malformed XML attributes (`AC (active)="…"`).
   */
  countStat?: {
    /** Placeholder name in the prompt template, e.g. "endpointCount". */
    placeholder: string;
    /** SQL returning a single COUNT(*) row. Never executed since 0.2.4. */
    sqlQuery: string;
    /** Human label after the count, e.g. "endpoints". */
    label: string;
  };

  /**
   * MCP tools listing line for this type's CUSTOM server, e.g.
   * "endpoint-tools: link_dto, unlink_dto". Optional since M13 — CRUD tools
   * live on the generic `entity-tools` server (composed by the host, not
   * per-type); a type contributes no line here unless it also registers a
   * custom `${type}-tools` server for non-CRUD tools.
   */
  mcpToolsLine?: string;

  /**
   * Optional domain-specific paragraph injected after the core narrative.
   * Budget: 2-3 sentences max, operational knowledge only (what the entity IS,
   * how it's referenced/embedded) — no implementation details (storage layout,
   * migrations, internal validation mechanics).
   */
  narrativeBlock?: string;
}

/**
 * Plugin host activation state, returned by GET /api/_meta/entities.
 */
export interface PluginActivationState {
  active: string[];
  inactive: string[];
  unknown: string[];
}
