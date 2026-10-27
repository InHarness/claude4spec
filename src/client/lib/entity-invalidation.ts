import type { QueryKey } from '@tanstack/react-query';
import { clientPluginHost } from '../core/plugin-host/host.js';

/**
 * 2.1.19 (M13 m13ui000 "Stan — Zapytania", M50 wsmq8cpb) — the HOST owns the
 * WS → query-key map for entity lists and entity details. Its one global
 * observer (`useFileWatcher`) runs it; no plugin panel subscribes to the WS for
 * this and the shell no longer takes a mapping declared by an entity detail
 * view — the shell keeps only the batching mechanism (and the editor / sidebar
 * maps).
 *
 * `entity:changed` / `entity:indexed { type, slug }` invalidate:
 * - `[<type plural>]` — the type's lists (`<type plural>` = last segment of the
 *   type's `pathPrefix`);
 * - `[<type>, slug]` — the single entity: chip resolver and the plugin's detail
 *   route;
 * - `['entities']` — the aggregate key;
 * - `['refLookup', <type>]` (2.1.41) — every `refLookup` resolution reading
 *   entities of that type, as a target or as a list's source rows.
 *
 * A plugin whose query keys follow this convention gets its open list and open
 * detail refreshed after an external change (agent, another tab) without a
 * page reload; a key of another shape is not invalidated. The version history
 * (`['versions', <type>, slug]`) is deliberately NOT on the map.
 */

/**
 * An entity type → its React Query list key (plural).
 *
 * 0.2.11: derived from the type's own `pathPrefix` (last segment) instead of a
 * five-entry map.
 *
 * Falls back to `entities` when the type is unknown to the client host — which
 * includes the window before plugin boot settles, where answering with a
 * specific key would be a guess.
 */
export function entityListKey(type: string): string {
  const prefix = clientPluginHost.getAvailable(type)?.pathPrefix;
  const base = prefix?.split('/').filter(Boolean).pop();
  return base ?? 'entities';
}

/** The keys an `entity:changed` / `entity:indexed { type, slug }` invalidates. */
export function entityChangeKeys(type: string, slug: string): QueryKey[] {
  return [[entityListKey(type)], [type, slug], ['entities'], ['refLookup', type]];
}

/** The keys a `tag:changed` invalidates: every active type's list (lists filter by tag). */
export function tagChangeKeys(): QueryKey[] {
  return [['tags'], ...clientPluginHost.listEntities().map((m) => [entityListKey(m.type)]), ['entities']];
}
