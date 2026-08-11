import type { EntityType } from '../../shared/entities.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { isHiddenModule } from '../core/plugin-host/slot-rules.js';
import { openEntityOverlay } from '../ui/events.js';

interface OpenTarget {
  openEntity(type: EntityType, slug: string): void;
}

/**
 * Where a chip or card click goes, for ANY entity type.
 *
 * A normal type navigates to its detail route through the editor bridge. A
 * hidden type has no such route — it declares neither `routes` nor
 * `detailPanel` — so it opens its own read-only fullscreen overlay instead.
 * That is the ONLY sanctioned exception to "a click calls
 * `bridge.openEntity`", and 0.2.16 moved the test for it from a declared flag
 * to the slots themselves, so the exception cannot be claimed by a type that
 * has somewhere to navigate. One helper rather than a branch at each of the
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
  // The MODULE, not the legacy `EntityDef` projection of it: hidden-ness is read
  // off `routes`/`detailPanel`, and `EntityDef` — a shape that predates routes —
  // cannot carry the first of those. `getEntity` respects activation, so an
  // inactive type still resolves to nothing and takes the broken-chip path.
  const module = clientPluginHost.getEntity(type);
  if (!module) return undefined;
  if (isHiddenModule(module)) {
    return () => openEntityOverlay({ type, slug, ...(caption ? { caption } : {}) });
  }
  if (!bridge) return undefined;
  return () => bridge.openEntity(type as EntityType, slug);
}
