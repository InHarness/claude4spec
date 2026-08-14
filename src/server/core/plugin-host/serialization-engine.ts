/**
 * SerializationEngine — host-driven dispatch for L9 entity serialization.
 *
 * Host-driven L9 dispatch (M13). All entity serializers come
 * from the plugin host's `BackendModule.serializer` slot; the only internal
 * registration is the `section` non-entity serializer, kept here because
 * section is not a plugin (M06 owns it).
 *
 * M31: was a singleton bound to the `pluginHost` singleton — now a class
 * instantiated once per ProjectContext (`ctx.serialization`) and once per CLI
 * process, bound to that context's ProjectPluginHost.
 */

import type {
  RawEntity,
  RawEntityReader,
  RawEntityType,
} from '../../discovery/raw-entity-reader.js';
import { genericEntity } from '../../serialization/generic.js';
import { recordSchema } from '../../../shared/plugin-host/json-schema.js';
import type {
  JsonSchema,
  SerializationContribution,
  SerializeResult,
} from '../../serialization/types.js';
import { SerializerError } from '../../serialization/types.js';
import type { ProjectPluginHost } from './types.js';

export interface CatalogEntry {
  count: number;
  payloadVersion: number;
  description: string;
  roleNoun: string;
  /** M13: only the type's CUSTOM server, e.g. "endpoint-tools: link_dto, unlink_dto". Absent when the type has no custom tools. */
  mcpToolsLine?: string;
  /** M13: whether this type's CRUD is reachable via the generic entity-tools server (has a declared backend.crud). */
  crudSupported: boolean;
}

export interface CatalogResult {
  types: Record<string, CatalogEntry>;
  /** M13: present iff at least one active type supports CRUD — the generic entity-tools row, composed from the host, not any single manifest. */
  entityTools?: { mcpToolsLine: string };
}

const ENTITY_TOOLS_MCP_LINE =
  'entity-tools: create_entities, get_entities, update_entities, delete_entities, list_entities, search_entities, describe_entity_type';

export interface DescribeResult {
  type: string;
  payloadVersion: number;
  /**
   * ONE schema, under the key `record`.
   *
   * 0.2.22 removed the sibling `views: ViewKind[]` — it listed the kinds as a
   * CHOICE, and there was no longer a choice to make. 0.2.23 removes the five
   * schemas themselves: a caller reads ONE shape, narrowed by its own `select`,
   * so publishing five was publishing four shapes nothing can ask for. The field
   * stays plural because the envelope names it that way and a type may yet
   * publish a second, genuinely different, schema.
   */
  schemas: Record<string, JsonSchema>;
}

export class SerializationEngine {
  constructor(private readonly host: ProjectPluginHost) {}

  has(type: string): boolean {
    return this.host.getAvailable(type) !== null;
  }

  get(type: string): SerializationContribution<unknown> | undefined {
    return this.host.getAvailable(type)?.serializer;
  }

  listTypes(): string[] {
    return this.host.listAvailable().map((m) => m.type).sort();
  }

  /**
   * The type's payload version, from the MANIFEST — the authority, per
   * registration's cross-check against the contribution's copy. `null` for
   * `section`, which is not an entity and has no payload to version.
   */
  getPayloadVersion(type: string): number | null {
    return this.host.getAvailable(type)?.payloadVersion ?? null;
  }

  /**
   * The read record for one entity, derived wholly from its type's `data.schema`.
   *
   * 0.2.23 removed the three-case registry this used to run — "the type computes
   * this view", "the type left it to the host", "the type's view threw" — and
   * the `view` parameter that selected between shapes. There is one producer and
   * one shape; a fork between an authored and a generated record cannot exist
   * when nothing is authored.
   *
   * An unregistered type THROWS rather than returning a shaped apology. The old
   * code answered with a generic payload plus `error: 'unknown_type'`, which a
   * caller reading only `data` could not tell from a real record.
   *
   * This is a BACKSTOP, not the gate. Every discovery caller passes
   * `requireActiveType` first, which resolves through `getEntity` — the
   * active-checked lookup — and raises a proper `INVALID_TYPE`. Resolution here
   * goes through `getAvailable`, which ignores the active whitelist, so a
   * DEACTIVATED type does not reach this throw: it is refused earlier, and were
   * it not, it would serialize normally. What is left for this line to catch is
   * a type the host has never registered arriving by some path that skipped the
   * guard — a bug, and it surfaces as one rather than as data.
   */
  serializeEntity(
    type: string,
    entity: RawEntity,
    reader: RawEntityReader,
    /** Passed down so an unselected projected collection is never queried. */
    select?: readonly string[],
  ): SerializeResult {
    const m = this.host.getAvailable(type);
    if (!m) throw new SerializerError(type);
    return { data: genericEntity(entity, m.data?.schema, reader, select) };
  }

  /**
   * The schema of one type's read record, DERIVED from its `data.schema`.
   *
   * 0.2.9 removed the other path: a hand-written `serializer.schema(view)` when
   * the type had one, reflection over the SQLite columns (stamped `_auto`) when
   * it did not, and a stub apologising for the missing db handle when there was
   * none. 0.2.23 removed the remaining axis — a schema PER VIEW — because the
   * views it described are gone. One type, one schema.
   */
  getSchema(type: string): JsonSchema {
    const m = this.host.getAvailable(type);
    if (!m) return { type: 'object', properties: {}, required: [] };
    return recordSchema({ type, data: m.data });
  }

  /**
   * Lightweight smoke test: per active entity type, a row count, the payload
   * version, a one-line description, and the type's `roleNoun` /
   * `mcpToolsLine` (all from the per-type system-prompt slot, the same source
   * the M05 system prompt uses). Deliberately does NOT derive schemas — use
   * {@link describe} for those. Iterates active
   * plugins via `host.listEntities()` (deactivated plugins absent).
   */
  catalog(reader: RawEntityReader): CatalogResult {
    const types: Record<string, CatalogEntry> = {};
    let anyCrudSupported = false;
    for (const m of this.host.listEntities()) {
      /**
       * 2.0.0 (item 28) — every active type has CRUD by construction. It used to
       * mean "shipped a `backend.crud`"; that slot is gone, and the schemas are
       * generated from `data.schema`, which every active type declares.
       */
      const crudSupported = true;
      anyCrudSupported = true;
      types[m.type] = {
        count: reader.count(m.type as RawEntityType),
        payloadVersion: m.payloadVersion,
        // All three read the per-type systemPrompt slot (chat-context.ts).
        description: m.systemPrompt.narrativeBlock ?? m.systemPrompt.roleNoun,
        roleNoun: m.systemPrompt.roleNoun,
        mcpToolsLine: m.systemPrompt.mcpToolsLine,
        crudSupported,
      };
    }
    return {
      types,
      ...(anyCrudSupported ? { entityTools: { mcpToolsLine: ENTITY_TOOLS_MCP_LINE } } : {}),
    };
  }

  /**
   * On-demand schema discovery for one active entity type. Returns null when
   * the type is unknown or deactivated (caller maps to INVALID_TYPE). Schemas
   * are derived from `data.schema` — see {@link getSchema}.
   *
   * 0.2.22 dropped the `view` parameter and the `views` list; 0.2.23 drops the
   * five schemas behind them. A view was an internal shape worth publishing only
   * while the host could produce five of them.
   */
  describe(type: string): DescribeResult | null {
    const m = this.host.listEntities().find((e) => e.type === type);
    if (!m) return null;
    return { type, payloadVersion: m.payloadVersion, schemas: { record: this.getSchema(type) } };
  }
}
