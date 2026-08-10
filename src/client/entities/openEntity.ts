import type { EntityType } from '../../shared/entities.js';
import { getEntityDef } from './registry.js';
import { openEntityOverlay } from '../ui/events.js';

interface OpenTarget {
  openEntity(type: EntityType, slug: string): void;
}

/**
 * 0.2.15 — where a chip or card click goes, for ANY entity type.
 *
 * A normal type navigates to its detail route through the editor bridge. A
 * hidden (`embedOnly`) type has no such route, so it opens its read-only
 * fullscreen overlay instead. One helper rather than a branch at each of the
 * three call sites (`SingleElementView`, `InlineMentionView`, the chat chip
 * dispatcher), because a fourth call site getting it wrong would be a chip that
 * silently navigates to a 404.
 *
 * Returns `undefined` when the type resolves to nothing — the broken-chip case,
 * where clicking must do nothing at all rather than open an empty overlay.
 */
export function openEntityHandler(
  type: string,
  slug: string,
  bridge: OpenTarget | null | undefined,
  caption?: string,
): (() => void) | undefined {
  const def = getEntityDef(type);
  if (!def) return undefined;
  if (def.embedOnly) {
    return () => openEntityOverlay({ type, slug, ...(caption ? { caption } : {}) });
  }
  if (!bridge) return undefined;
  return () => bridge.openEntity(type as EntityType, slug);
}
