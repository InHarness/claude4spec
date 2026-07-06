/**
 * EntityModule manifest types shared between server and client.
 *
 * Server-only slots (serializer, services, mcpServer, routes, systemPrompt)
 * live in src/server/core/plugin-host/types.ts. Client-only slots (React
 * components, RouteTreeFragment, editor extensions) live in
 * src/client/core/plugin-host/types.ts. The split prevents bundlers from
 * pulling better-sqlite3/express into the client bundle.
 */

export interface EntityModuleManifest {
  /** Stable type discriminator, kebab-case. 1:1 with XML tag attribute. */
  type: string;

  /** SQLite table name; differs from `type` when type contains a hyphen. */
  table: string;

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

  /** Count statistic injection point. */
  countStat: {
    /** Placeholder name in the prompt template, e.g. "endpointCount". */
    placeholder: string;
    /** SQL returning a single COUNT(*) row. */
    sqlQuery: string;
    /** Human label after the count, e.g. "endpoints". */
    label: string;
  };

  /** MCP tools listing line, e.g. "endpoint-tools: create_endpoint, ...". */
  mcpToolsLine: string;

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
