/**
 * SerializationEngine — host-driven dispatch for L9 entity serialization.
 *
 * Host-driven L9 dispatch (M13). All entity serializers come
 * from the plugin host's `BackendModule.serializer` slot; the only internal
 * registration is the `section` non-entity serializer, kept here because
 * section is not a plugin (M06 owns it).
 */

import type { Database } from 'better-sqlite3';
import type { RawEntity, RawEntityReader, RawSection } from '../../domain/raw-entity-reader.js';
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
import { pluginHost } from './host.js';

const MAX_DEPTH = 1;

export interface CatalogEntry {
  version: string;
  views: string[];
  schemas: Record<string, JsonSchema>;
}

export interface CatalogResult {
  types: Record<string, CatalogEntry>;
}

class SerializationEngineImpl {
  /** Section serializer is registered separately — section is not an entity. */
  private sectionSerializer: EntitySerializer<unknown> | null = null;

  attachSectionSerializer(serializer: EntitySerializer<unknown>): void {
    this.sectionSerializer = serializer;
  }

  has(type: string): boolean {
    if (type === 'section') return this.sectionSerializer !== null;
    return pluginHost.getAvailable(type) !== null;
  }

  get(type: string): EntitySerializer<unknown> | undefined {
    if (type === 'section') return this.sectionSerializer ?? undefined;
    return pluginHost.getAvailable(type)?.serializer;
  }

  listTypes(): string[] {
    const types = pluginHost.listAvailable().map((m) => m.type);
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
    if (db) return autoDerivedSchema(db, type);
    return { type: 'object', _auto: true, _note: 'schema unavailable without db handle' };
  }

  catalog(reader: RawEntityReader, db: Database): CatalogResult {
    const types: Record<string, CatalogEntry> = {};
    for (const t of this.listTypes()) {
      const serializer = this.get(t);
      if (!serializer) continue;
      const views: string[] = [];
      if (serializer.inlineMention) views.push('inline_mention');
      if (serializer.singleElement) views.push('single_element');
      if (serializer.elementListItem) views.push('element_list_item');
      if (serializer.taggedListItem) views.push('tagged_list_item');
      if (serializer.detail) views.push('detail');
      const schemas: Record<string, JsonSchema> = {};
      const viewList: ViewKind[] = [
        'inline_mention',
        'single_element',
        'element_list_item',
        'tagged_list_item',
        'detail',
      ];
      for (const view of viewList) {
        schemas[view] = this.getSchema(t, view, db);
      }
      types[t] = { version: serializer.version, views, schemas };
    }
    void reader;
    return { types };
  }
}

export const serializationEngine = new SerializationEngineImpl();

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
