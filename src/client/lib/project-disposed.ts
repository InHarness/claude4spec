import type { ProjectDisposedReason } from '../../shared/types.js';

/**
 * The SPA's answer to `project:disposed` — the server is about to close this
 * project's room because its `ProjectContext` was retired.
 *
 * M31: by default the tab reloads — every cached query points at a
 * stale/about-to-be-torn-down context (config change, workspace detach, a branch
 * checkout in ANOTHER tab).
 *
 * 2.1.16 (M50 `8h2a734u`, `6z6uzzhv`): `reason: 'activation-changed'` — the
 * context was rebuilt only because a Settings → Entities save changed which
 * entity types are active. (A Trust plugins answer sends no reason — it swaps
 * the overlay layer, so it keeps the reload.) No reload:
 * the acting tab re-applies activation itself (`refreshPluginActivation`), so
 * its ELEMENTS tabs change in place; any other tab keeps its tabs until the page
 * is reloaded. Cached queries are refetched against the rebuilt context; the
 * socket reconnects on its own (`onclose`).
 */
export function handleProjectDisposed(
  event: { reason?: ProjectDisposedReason },
  deps: { reload(): void; invalidateAll(): void },
): void {
  if (event.reason === 'activation-changed') {
    deps.invalidateAll();
    return;
  }
  deps.reload();
}
