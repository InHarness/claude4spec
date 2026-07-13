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

import type { Database } from 'better-sqlite3';
import type {
  RawEntity,
  RawEntityReader,
  RawEntityType,
  RawSection,
} from '../../domain/raw-entity-reader.js';
import { fallbackEntity, fallbackSection } from '../../serialization/fallback.js';
import { autoDerivedSchema } from '../../serialization/auto-schema.js';
import type {
  EntitySerializer,
  JsonSchema,
  SerializeContext,
  SerializeFn,
  SerializeResult,
  ViewKind,
} from '../../serialization/types.js';
import type { ProjectPluginHost } from './types.js';

const MAX_DEPTH = 1;

export interface CatalogEntry {
  count: number;
  version: string;
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
  version: string;
  views: string[];
  schemas: Record<string, JsonSchema>;
}

export class SerializationEngine {
  constructor(
    private readonly host: ProjectPluginHost,
    /** Section serializer is registered separately — section is not an entity. */
    private readonly sectionSerializer: EntitySerializer<unknown> | null = null,
  ) {}

  has(type: string): boolean {
    if (type === 'section') return this.sectionSerializer !== null;
    return this.host.getAvailable(type) !== null;
  }

  get(type: string): EntitySerializer<unknown> | undefined {
    if (type === 'section') return this.sectionSerializer ?? undefined;
    return this.host.getAvailable(type)?.serializer;
  }

  listTypes(): string[] {
    const types = this.host.listAvailable().map((m) => m.type);
    if (this.sectionSerializer) types.push('section');
    return types.sort();
  }

  getVersion(type: string): string | null {
    return this.get(type)?.version ?? null;
  }

  serializeEntity(
    type: string,
    view: ViewKind,
    entity: RawEntity,
    reader: RawEntityReader,
    depth = 0
  ): SerializeResult {
    return this.invoke(type, view, entity, reader, depth, () => fallbackEntity(entity, view));
  }

  serializeSection(view: ViewKind, section: RawSection, reader: RawEntityReader): SerializeResult {
    return this.invoke('section', view, section, reader, 0, () => fallbackSection(section, view));
  }

  private invoke(
    type: string,
    view: ViewKind,
    input: unknown,
    reader: RawEntityReader,
    depth: number,
    buildFallback: () => Record<string, unknown>
  ): SerializeResult {
    const serializer = this.get(type);
    if (!serializer) {
      return { data: buildFallback(), fallback: true, error: 'no_serializer' };
    }
    const method = pickMethod(serializer, view);
    if (!method) {
      return { data: buildFallback(), fallback: true };
    }
    const ctx: SerializeContext = { reader, depth, maxDepth: MAX_DEPTH };
    try {
      const data = method(input, ctx);
      const brokenRefs = extractBrokenRefs(data);
      return { data, fallback: false, ...(brokenRefs ? { brokenRefs } : {}) };
    } catch (err) {
      return {
        data: buildFallback(),
        fallback: true,
        error: `serializer_threw: ${(err as Error).message}`,
      };
    }
  }

  getSchema(type: string, view: ViewKind, db?: Database): JsonSchema {
    const serializer = this.get(type);
    if (serializer?.schema) return serializer.schema(view);
    if (db) return autoDerivedSchema(db, type, this.host);
    return { type: 'object', _auto: true, _note: 'schema unavailable without db handle' };
  }

  /**
   * Lightweight smoke test: per active entity type, a row count, serializer
   * version, a one-line description, and the type's `roleNoun` /
   * `mcpToolsLine` (all from the per-type system-prompt slot, the same source
   * the M05 system prompt uses). Deliberately does NOT read
   * `serializer.schema` — use {@link describe} for schemas. Iterates active
   * plugins via `host.listEntities()` (deactivated plugins absent).
   */
  catalog(reader: RawEntityReader): CatalogResult {
    const types: Record<string, CatalogEntry> = {};
    let anyCrudSupported = false;
    for (const m of this.host.listEntities()) {
      const crudSupported = m.backend?.crud != null;
      if (crudSupported) anyCrudSupported = true;
      types[m.type] = {
        count: reader.count(m.type as RawEntityType),
        version: m.serializer.version,
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
   * all of the type's supported views are returned. Schemas come from
   * `serializer.schema(view)` or, when absent, schema reflection (`_auto`).
   */
  describe(type: string, view: ViewKind | undefined, db: Database): DescribeResult | null {
    const m = this.host.listEntities().find((e) => e.type === type);
    if (!m) return null;
    const serializer = m.serializer;
    const views: string[] = [];
    if (serializer.inlineMention) views.push('inline_mention');
    if (serializer.singleElement) views.push('single_element');
    if (serializer.elementListItem) views.push('element_list_item');
    if (serializer.taggedListItem) views.push('tagged_list_item');
    if (serializer.detail) views.push('detail');
    const targetViews: ViewKind[] = view ? [view] : (views as ViewKind[]);
    const schemas: Record<string, JsonSchema> = {};
    for (const v of targetViews) {
      schemas[v] = this.getSchema(type, v, db);
    }
    return { type, version: serializer.version, views, schemas };
  }
}

function pickMethod(
  serializer: EntitySerializer<unknown>,
  view: ViewKind
): SerializeFn<unknown> | undefined {
  switch (view) {
    case 'inline_mention':
      return serializer.inlineMention;
    case 'single_element':
      return serializer.singleElement;
    case 'element_list_item':
      return serializer.elementListItem;
    case 'tagged_list_item':
      return serializer.taggedListItem;
    case 'detail':
      return serializer.detail;
  }
}

function extractBrokenRefs(data: unknown): string[] | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const refs = (data as Record<string, unknown>)._brokenRefs;
  if (Array.isArray(refs) && refs.every((r) => typeof r === 'string')) return refs as string[];
  return undefined;
}
