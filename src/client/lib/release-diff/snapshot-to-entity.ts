/**
 * Adapter snapshot → entity-shape (M17 m17uidet01).
 *
 * Maps an `EntitySnapshot` (from `releaseService.getReleaseSnapshot()`) onto the
 * shape `EntityDef.renderCard` expects. Used to render the `from` state of a
 * card whose `op === 'deleted'`: the entity no longer exists in the live DB, so
 * `useGetBySlug` cannot supply it.
 *
 * 0.2.11 — one generic adapter instead of a `switch` over four hardcoded types.
 *
 * The switch returned `null` for anything else, and `EntityDiffCard` renders a
 * raw `<pre>` JSON dump when this yields nothing — so a deleted `ac`,
 * `design-system`, `diagram` or any plugin-contributed entity lost its card in
 * exactly the view meant to explain what was deleted. Now that releases capture
 * every active type, that gap would have widened with each new type.
 *
 * WHAT THE PER-TYPE FUNCTIONS DID THAT A BARE SPREAD DOES NOT. Each one coerced
 * its collection fields through `Array.isArray(x) ? x : []`, and cards rely on
 * that: `UiViewCard` does `[...entity.params].sort(...)`, `DtoCard` reads
 * `entity.fields.length`, `DesignSystemCard` maps `entity.groups`. A snapshot
 * predating a field — an older `entity_version.data`, or a type only now covered
 * by `buildSnapshot` — has no such key, and `undefined` there throws inside
 * render, blanking the whole diff view. A spread alone would have replaced a
 * harmless JSON dump with a crash.
 *
 * So the defaults are derived rather than dropped: the type's own `data.schema`
 * names its collection fields, and each missing one becomes `[]`. Same registry
 * that answers every other "what does this type have?" question, and it extends
 * to plugin types the hardcoded functions never covered.
 */

import { getEntityDef } from '../../entities/index.js';
import type { FieldNode } from '../../../shared/plugin-host/data-schema.js';

/** Field names the type declares as collections — the ones a card may iterate. */
function collectionFields(type: string): string[] {
  const schema = (getEntityDef(type) as { data?: { schema?: Record<string, FieldNode> } } | null)?.data
    ?.schema;
  if (!schema) return [];
  return Object.entries(schema)
    .filter(([, node]) => node?.kind === 'collection')
    .map(([name]) => name);
}

export function snapshotToEntity(type: string, data: unknown): unknown | null {
  if (data == null || typeof data !== 'object') return null;
  const s = data as Record<string, unknown>;

  const out: Record<string, unknown> = {
    // Defaults for what a snapshot structurally cannot carry. Listed before the
    // spread so any of them the snapshot DOES carry takes precedence.
    createdAt: '',
    updatedAt: '',
    tags: [],
    ...s,
    slug: String(s.slug ?? ''),
  };

  // Every declared collection is an array by the time a card sees it, whatever
  // the stored payload happened to contain.
  for (const field of collectionFields(type)) {
    if (!Array.isArray(out[field])) out[field] = [];
  }
  if (!Array.isArray(out.tags)) out.tags = [];

  return out;
}
