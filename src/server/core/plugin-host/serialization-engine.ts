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
  RawSection,
} from '../../discovery/raw-entity-reader.js';
import { genericEntity, genericSection } from '../../serialization/generic.js';
import { viewSchema } from '../../../shared/plugin-host/json-schema.js';
import type {
  JsonSchema,
  SerializationContribution,
  SerializeResult,
  ViewFn,
  ViewKind,
  ViewSet,
} from '../../serialization/types.js';
import { VIEW_KINDS } from '../../serialization/types.js';
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
   * Keyed by view kind, all five, for every active type.
   *
   * 0.2.22 removed the sibling `views: ViewKind[]`. It listed the kinds as a
   * CHOICE, and there is no longer a choice to make — a caller states a `select`
   * and the host decides internally what to serialize before projecting. These
   * schemas stay because they describe shapes this host really can produce;
   * which of them is computed and which is generic is carried inside each one
   * (`x-computed`).
   */
  schemas: Record<string, JsonSchema>;
}

export class SerializationEngine {
  constructor(
    private readonly host: ProjectPluginHost,
    /** Section serializer is registered separately — section is not an entity. */
    private readonly sectionViews: ViewSet<unknown> | null = null,
  ) {}

  has(type: string): boolean {
    if (type === 'section') return this.sectionViews !== null;
    return this.host.getAvailable(type) !== null;
  }

  /** The views a type computes itself. `section` is a bare view set — it has no manifest. */
  views(type: string): ViewSet<unknown> | undefined {
    if (type === 'section') return this.sectionViews ?? undefined;
    return this.host.getAvailable(type)?.serializer.views;
  }

  get(type: string): SerializationContribution<unknown> | undefined {
    if (type === 'section') return undefined;
    return this.host.getAvailable(type)?.serializer;
  }

  listTypes(): string[] {
    const types = this.host.listAvailable().map((m) => m.type);
    if (this.sectionViews) types.push('section');
    return types.sort();
  }

  /**
   * The type's payload version, from the MANIFEST — the authority, per
   * registration's cross-check against the contribution's copy. `null` for
   * `section`, which is not an entity and has no payload to version.
   */
  getPayloadVersion(type: string): number | null {
    return this.host.getAvailable(type)?.payloadVersion ?? null;
  }

  serializeEntity(
    type: string,
    view: ViewKind,
    entity: RawEntity,
    reader: RawEntityReader
  ): SerializeResult {
    return this.invoke(type, view, entity, reader, () =>
      genericEntity(entity, view, this.host.getAvailable(type)?.data?.schema),
    );
  }

  serializeSection(view: ViewKind, section: RawSection, reader: RawEntityReader): SerializeResult {
    return this.invoke('section', view, section, reader, () => genericSection(section, view));
  }

  private invoke(
    type: string,
    view: ViewKind,
    input: unknown,
    reader: RawEntityReader,
    buildGeneric: () => Record<string, unknown>
  ): SerializeResult {
    if (!this.has(type)) {
      return { data: buildGeneric(), generic: true, error: 'unknown_type' };
    }
    const fn: ViewFn<unknown> | undefined = this.views(type)?.[view];
    if (!fn) {
      // The RULE, not a failure: the type declared its data and left this view
      // to the host.
      return { data: buildGeneric(), generic: true };
    }
    try {
      const data = fn(input, reader);
      const brokenRefs = extractBrokenRefs(data);
      return { data, generic: false, ...(brokenRefs ? { brokenRefs } : {}) };
    } catch (err) {
      return {
        data: buildGeneric(),
        generic: true,
        error: `serializer_threw: ${(err as Error).message}`,
      };
    }
  }

  /**
   * The schema of one type × one view, DERIVED from the type's `data.schema`.
   *
   * 0.2.9 removed the other path: a hand-written `serializer.schema(view)` when
   * the type had one, reflection over the SQLite columns (stamped `_auto`) when
   * it did not, and a stub apologising for the missing db handle when there was
   * none. One derivation, no db, no `_auto`.
   */
  getSchema(type: string, view: ViewKind): JsonSchema {
    const m = this.host.getAvailable(type);
    if (!m) return { type: 'object', properties: {}, required: [] };
    return viewSchema({ type, data: m.data, view, computed: !!m.serializer.views?.[view] });
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
   * the type is unknown or deactivated (caller maps to INVALID_TYPE). When
   * `view` is given the response is narrowed to that single view; otherwise
   * every view is returned, because every type answers every view. Schemas are
   * derived from `data.schema` — see {@link getSchema}.
   */
  /**
   * 0.2.22 — no `view` parameter, and no `views` in the answer.
   *
   * The five schemas are still emitted: a view remains an INTERNAL shape, and
   * the schema of each is a real fact about what this host can produce. What
   * disappears is the caller's ability to ask for one of them, and the list that
   * implied they had a choice.
   */
  describe(type: string): DescribeResult | null {
    const m = this.host.listEntities().find((e) => e.type === type);
    if (!m) return null;
    const schemas: Record<string, JsonSchema> = {};
    for (const v of VIEW_KINDS) {
      schemas[v] = this.getSchema(type, v);
    }
    return { type, payloadVersion: m.payloadVersion, schemas };
  }
}

function extractBrokenRefs(data: unknown): string[] | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const refs = (data as Record<string, unknown>)._brokenRefs;
  if (Array.isArray(refs) && refs.every((r) => typeof r === 'string')) return refs as string[];
  return undefined;
}
