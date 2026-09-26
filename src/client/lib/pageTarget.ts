/**
 * 0.2.110 M14/M50 — the `/space/<rootId>/<path>` target of a resolved `@path` chip.
 *
 * The page-links index mixes two key shapes: source entries are composite
 * `${rootId}:${path}`, resolved targets are bare paths (the server resolves a
 * mention inside its source's own root). A composite key names its root; a bare
 * path belongs to `fallbackRootId` — the root of the document the chip lives in.
 * A `:` prefix that is not a known root id is part of the path, not a root.
 */
export function pageTarget(
  resolved: string,
  rootIds: readonly string[],
  fallbackRootId: string,
): { rootId: string; path: string } {
  const i = resolved.indexOf(':');
  if (i > 0 && rootIds.includes(resolved.slice(0, i))) {
    return { rootId: resolved.slice(0, i), path: resolved.slice(i + 1) };
  }
  return { rootId: fallbackRootId, path: resolved };
}
