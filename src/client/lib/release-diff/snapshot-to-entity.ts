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
 * Nothing type-specific was lost with the per-type functions. Each one copied
 * the snapshot's own fields across verbatim and filled the rest with stubs the
 * card components do not read: empty `createdAt`/`updatedAt` (a snapshot has no
 * audit columns) and empty junction arrays (`endpoint.dtos`, `dto.endpoints`).
 * The spread below does the same thing without naming a type: stubs first so a
 * snapshot that carries a real value always wins.
 */

export function snapshotToEntity(type: string, data: unknown): unknown | null {
  if (data == null || typeof data !== 'object') return null;
  const s = data as Record<string, unknown>;
  return {
    // Defaults for what a snapshot structurally cannot carry. Listed before the
    // spread so any of them the snapshot DOES carry takes precedence.
    createdAt: '',
    updatedAt: '',
    tags: [],
    ...s,
    slug: String(s.slug ?? ''),
  };
}
