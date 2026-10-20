import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { entitiesApi, type EntityBySlugRow } from '../lib/api.js';
import {
  collectRefFields,
  refLookupKey,
  refTargetsOf,
  type RefTarget,
} from '../../shared/plugin-host/ref-fields.js';
import type { FieldNode } from '../../shared/plugin-host/data-schema.js';
import { RESERVED_TITLE_FIELD } from '../../shared/plugin-host/data-schema.js';
import { ENTITY_REF_FALLBACK_ICON, type RefLookupEntry } from '../host-ui-kit/actions/EntityRefValue.js';

/**
 * 2.1.41 (M13 / M33) — the `refLookup` map: `${type}:${slug}` of a TARGET
 * record → `RefLookupEntry`.
 *
 * The mirror of `tagLookup`'s two sources: in a `renderRow` / `renderCard` slot
 * the host hands the map in (`useListRefLookup` per list, `useRefLookup` per
 * card); on a detail panel or a plugin's own screen `useRefLookup` builds it.
 * The host's detail panel uses the same hook — there is no second resolution
 * path.
 *
 * Which fields are references is the schema walk's call (`collectRefFields`),
 * the same walk rename propagation and write validation read. Targets are
 * resolved with ONE core "read by slugs" query per target type, under the query
 * key `['refLookup', <targetType>, …]`; `entity:changed` of any entity of that
 * type invalidates `['refLookup', <type>]` (see `entity-invalidation.ts`), the
 * way a tag change invalidates `['tags']`.
 */

/** The map a slot gets when there is nothing to resolve. */
export const EMPTY_REF_LOOKUP: ReadonlyMap<string, RefLookupEntry> = new Map();

/** The query-key root, per type. Shared by the list resolver, the card and `useRefLookup`. */
export const refLookupQueryKey = (type: string, ...rest: string[]) => ['refLookup', type, ...rest] as const;

type Schema = Readonly<Record<string, FieldNode>>;

function schemaOf(type: string): Schema | undefined {
  return (clientPluginHost.getAvailable(type) as { data?: { schema?: Schema } } | null)?.data?.schema;
}

/** A target type's tab icon from the host registry; a type without a tab gets the component's fallback. */
function iconOf(type: string) {
  return clientPluginHost.getEntity(type)?.sidebarTab?.icon ?? ENTITY_REF_FALLBACK_ICON;
}

const sortedUnique = (slugs: Iterable<string>): string[] => [...new Set(slugs)].sort();

/**
 * Resolve `(targetType, slug)` pairs into the map. One query per ACTIVE target
 * type; an inactive or unregistered target type is answered without a request.
 */
function useResolveRefTargets(targets: readonly RefTarget[]): ReadonlyMap<string, RefLookupEntry> {
  // Keyed by content, not by array identity: a caller handing `[entity]` inline
  // must not rebuild the map on every render.
  const targetsKey = targets.map((t) => refLookupKey(t.type, t.slug)).join('|');
  const byType = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const t of targets) map.set(t.type, [...(map.get(t.type) ?? []), t.slug]);
    return [...map.entries()].map(([type, slugs]) => ({ type, slugs: sortedUnique(slugs) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey]);

  const active = byType.filter((g) => clientPluginHost.getEntity(g.type));
  const results = useQueries({
    queries: active.map((g) => ({
      queryKey: refLookupQueryKey(g.type, g.slugs.join(',')),
      queryFn: () => entitiesApi.getBySlugs(g.type, g.slugs, []),
    })),
  });
  const stamp = results.map((r) => r.dataUpdatedAt).join(',');

  return useMemo(() => {
    if (!byType.length) return EMPTY_REF_LOOKUP;
    const rowsByType = new Map<string, EntityBySlugRow[] | undefined>(
      active.map((g, i) => [g.type, results[i]?.data]),
    );
    const out = new Map<string, RefLookupEntry>();
    for (const { type, slugs } of byType) {
      const icon = iconOf(type);
      const broken: RefLookupEntry['broken'] = clientPluginHost.getEntity(type)
        ? undefined
        : clientPluginHost.getAvailable(type)
          ? 'inactive'
          : 'unknown';
      if (broken) {
        for (const slug of slugs) out.set(refLookupKey(type, slug), { title: slug, icon, broken });
        continue;
      }
      const rows = rowsByType.get(type);
      // Not fetched yet: no entry, so the value draws as "not found" only once the answer is in.
      if (!rows) continue;
      const found = new Map(rows.map((r) => [r.slug, r.entity] as const));
      for (const slug of slugs) {
        const entity = found.get(slug);
        if (!entity) {
          out.set(refLookupKey(type, slug), { title: slug, icon, broken: 'deleted' });
          continue;
        }
        const title = entity[RESERVED_TITLE_FIELD];
        out.set(refLookupKey(type, slug), { title: typeof title === 'string' && title ? title : slug, icon });
      }
    }
    return out;
    // `stamp` stands for `results`, whose array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byType, stamp]);
}

/**
 * The `refLookup` of entities handed in directly — a card's one entity, a
 * detail panel's record, a plugin screen's list.
 *
 * @param type the type whose `data.schema` declares the reference fields
 * @param entities payloads of that type
 */
export function useRefLookup<T>(type: string, entities: readonly T[]): ReadonlyMap<string, RefLookupEntry> {
  const schema = schemaOf(type);
  const targets = useMemo(() => refTargetsOf(schema, entities), [schema, entities]);
  return useResolveRefTargets(targets);
}

/**
 * The `refLookup` a host list (`element_list`, `tagged_list`,
 * `tagged_list_mixed`, a chat tool's rows) hands EVERY row — computed once per
 * list, never per row. The list knows its rows by `(type, slug)`; their payloads
 * are read here with one "read by slugs" query per row type, narrowed to the
 * top-level fields that hold references, and only for a type that declares any.
 */
export function useListRefLookup(rows: ReadonlyArray<{ type: string; slug: string }>): ReadonlyMap<string, RefLookupEntry> {
  const rowsKey = rows.map((r) => refLookupKey(r.type, r.slug)).join('|');
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.type, [...(map.get(r.type) ?? []), r.slug]);
    return [...map.entries()]
      .map(([type, slugs]) => {
        const refs = collectRefFields(schemaOf(type)).refs;
        const select = sortedUnique(refs.map((s) => s.path.split('.')[0]!.replace(/\[\]$/, '')));
        return { type, slugs: sortedUnique(slugs), select };
      })
      .filter((g) => g.select.length > 0 && clientPluginHost.getEntity(g.type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsKey]);

  const sources = useQueries({
    queries: groups.map((g) => ({
      queryKey: refLookupQueryKey(g.type, 'source', g.select.join(','), g.slugs.join(',')),
      queryFn: () => entitiesApi.getBySlugs(g.type, g.slugs, g.select),
    })),
  });
  const stamp = sources.map((s) => s.dataUpdatedAt).join(',');

  const targets = useMemo(() => {
    const out: RefTarget[] = [];
    groups.forEach((g, i) => {
      const entities = (sources[i]?.data ?? []).map((r) => r.entity).filter((e) => e != null);
      out.push(...refTargetsOf(schemaOf(g.type), entities));
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, stamp]);

  return useResolveRefTargets(targets);
}
