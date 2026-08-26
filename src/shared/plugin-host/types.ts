/**
 * EntityModule manifest types shared between server and client.
 *
 * Server-only slots (serializer, services, mcpServer, routes, systemPrompt)
 * live in src/server/core/plugin-host/types.ts. Client-only slots (React
 * components, RouteTreeFragment, editor extensions) live in
 * src/client/core/plugin-host/types.ts. The split prevents bundlers from
 * pulling better-sqlite3/express into the client bundle.
 */

import type { DefaultPredicate, DataDeclaration } from './data-schema.js';
import type { SlugPattern } from './slug-pattern.js';

export interface EntityModuleManifest {
  /** Stable type discriminator, kebab-case. 1:1 with XML tag attribute. */
  type: string;

  /**
   * Host API 2.0.0 — the LOGICAL SCHEMA. Required.
   *
   * The host derives from it: the SQLite projection (`src/server/db/projection.ts`),
   * the composition descriptor, the searchable paths, and — in later tiers — the
   * CRUD input schemas and snapshot/restore. See `./data-schema.ts`.
   */
  data: DataDeclaration;

  /**
   * Host API 2.0.0 — how a slug is derived at CREATE, as data rather than as a
   * function. Replaces `slugFrom`. See `./slug-pattern.ts`.
   */
  slugPattern: SlugPattern;

  /**
   * What a CREATE does when the derived slug is taken. Defaults to `'reject'`.
   *
   * The two answers are both correct, for different KINDS of slug source, and
   * the six built-ins were split on it exactly that way: `ac` (slugified from
   * free-form `text`) and `diagram` (from an optional `caption`) suffixed —
   * `-2`, `-3` — because two acceptance criteria that happen to start the same
   * way are two different criteria. The other four derive their slug from an
   * IDENTITY (`dto`/`ui-view`/`design-system` from `name`, `endpoint` from
   * method + path) and threw `SLUG_CONFLICT`, because a second `GET /api/users`
   * is not a second endpoint, it is the same one documented twice.
   *
   * Tier E generalized the suffix to everything, on the strength of `ac`'s
   * comment. That silently turned "you already have this" into a duplicate the
   * author will edit while every `<single_element slug="…"/>` keeps resolving to
   * the stale original. `'reject'` is the default because it is what five of the
   * six did and because the failure is loud rather than silent; a type whose
   * slug is prose says so.
   */
  slugConflict?: 'reject' | 'suffix';

  /**
   * Host API 2.0.0 — version of the PAYLOAD shape, a positive integer.
   *
   * Distinct from the serializer's old `version: string`, which was semver, was
   * never enforced, and described the serializer rather than the data. This one
   * is the index into `payloadUpgrades` (tier B) and is what gets stamped into
   * `entity_version.serializer_version` at capture.
   */
  payloadVersion: number;



  /** Singular human label, e.g. "Endpoint". */
  label: string;

  /** Plural human label, e.g. "Endpoints" — used in sidebar tabs and prose. */
  labelPlural: string;

  /** Sidebar / display ordering hint (lower = earlier). */
  displayOrder: number;

  /**
   * Derive a slug from a CreateInput payload.
   *
   * @deprecated Removed in Host API 2.0.0 — see {@link EntityModuleManifest.slugPattern}.
   * A function could read the database, call a service or answer differently on
   * a second call, which made slug derivation the one part of a type's identity
   * the host could neither inspect nor reproduce. The slot is gone; a manifest
   * still declaring it is rejected at registration with a migration descriptor.
   */
  slugFrom?: never;

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
 * SystemPromptContribution — slot consumed by buildSystemPrompt (M05).
 * Server-only at runtime, but the shape is shared so plugins can declare it
 * uniformly. Plugins set this as part of their backend manifest.
 */
export interface SystemPromptContribution {
  /** Plural noun for role description, e.g. "Endpoints". */
  roleNoun: string;

  /**
   * Host API 2.0.0 — a DECLARATIVE count filter, replacing `countStat`.
   *
   * `countStat.sqlQuery` was deprecated-and-ignored in 0.2.4 (the last place a
   * module handed the host raw SQL) and is removed here. Ignoring it cost `ac`
   * its `status = 'active'` filter, which is what this restores — as data the
   * host evaluates, over the type's own fields, with no SQL crossing the
   * manifest boundary.
   *
   * The same predicate feeds the `<project>` block's count and the sidebar's, so
   * the number the agent sees and the number the user sees cannot diverge.
   * Absent or empty means count everything. The label still comes from
   * `labelPlural`.
   */
  defaultPredicate?: DefaultPredicate;

  /**
   * MCP tools listing line for this type's CUSTOM server, e.g.
   * "endpoint-tools: link_dto, unlink_dto". Optional since M13 — CRUD tools
   * live on the generic `entity-tools` server (composed by the host, not
   * per-type); a type contributes no line here unless it also registers a
   * custom `${type}-tools` server for non-CRUD tools.
   *
   * 0.2.50 — this slot NO LONGER feeds the prompt's `<tooling>` block. That
   * block is now derived from the servers actually mounted for the turn (their
   * `McpServerFactory.tools`, after the context profile's gate), so a
   * hand-written line here can no longer make the prompt advertise a tool that
   * is absent, or stay silent about one that is present. The field remains
   * because the rest of the host reads it as a DECLARATION of the type's custom
   * operations — `serialization-engine`, `composition-validation`,
   * `data-schema-validation` (as an "is this operation known" check), the
   * discovery meta surface, and the `spec-explore` subagent's tool allow-list.
   * Keep it accurate; it is a manifest fact, no longer prompt copy.
   */
  mcpToolsLine?: string;

  /**
   * Optional domain-specific paragraph injected after the core narrative — one
   * `<entity type="…">` row in the prompt's `<entities>` block.
   *
   * 0.2.50 — the budget is stated by SUBJECT rather than by length, because the
   * old wording ("what the entity IS") invited exactly what had to be cut. What
   * belongs here is a RULE FOR USING THE TYPE THAT `describe_entity_type` DOES
   * NOT RETURN. That tool answers every question about shape — field names,
   * types, enums, required-ness, `constraints` (including named validators with
   * their own prose), `contentFields`, `selectableFields`, `searchableFields` —
   * and answers it DERIVED from the declared data schema, so it cannot drift
   * from what the host enforces, while a paragraph here can and did.
   *
   * So: no field lists, no enum values, no "read X with tool Y" (that is
   * `contentFields`), no embed grammar (that is `<entity_embeds>`), and no
   * implementation detail (storage layout, migrations, validation mechanics).
   * What is left is worth the tokens: when to reach for the type, the
   * conventions no validator enforces, and the refusals an agent would
   * otherwise read as a bug. 2-3 sentences.
   *
   * Note this text is ALSO the type's `description` in `c4s catalog` output
   * (`serialization-engine`), so it is read outside the prompt too.
   */
  narrativeBlock?: string;

  /**
   * 0.2.50 — full XML blocks this type contributes to the prompt's writing-
   * conventions layer, emitted in `listEntities()` order and ONLY while the type
   * is active.
   *
   * `narrativeBlock` answers "what is this entity" in two or three sentences,
   * inside the shared `<entities>` block. This slot is for the other thing a
   * type sometimes owns: a whole convention the agent must follow when writing
   * about it — the referencing grammar of `diagram`, say — which used to be
   * hardcoded in the core prompt builder and emitted even when the type was not
   * mounted. A block belongs to the type that owns the convention, and travels
   * with it.
   *
   * `name` is the XML tag name (used for ordering assertions and diagnostics);
   * `body` is the complete block including its opening and closing tags.
   */
  promptBlocks?: readonly { name: string; body: string }[];
}

/**
 * Plugin host activation state, returned by GET /api/_meta/entities.
 */
export interface PluginActivationState {
  active: string[];
  inactive: string[];
  unknown: string[];
}
