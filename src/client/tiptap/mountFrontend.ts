/**
 * M33 frontend wiring — the `mountFrontend` step.
 *
 * After plugin modules have handed their slots to `clientPluginHost`, this pins
 * each active module's contributions onto the host's single setup:
 *   - registers `editorExtensions` (NodeViews, slash commands, mention sources)
 *     into the shared extension REGISTRY, bound to the host's @tiptap/core;
 *   - auto-adds the entity-type name to the markdown-it xml_inline/xml_block
 *     allowlist so `<type .../>` parses as a native embed in prose;
 *   - (Phase 3) collects each module's `routes` fragment and mounts them into the
 *     host's single TanStack Router, deduped by path against the base routes; and
 *   - (Phase 3) acknowledges each module's `stateSlice` (typed but unconsumed).
 *
 * Editor wiring must run BEFORE the first editor is created (Tiptap freezes its
 * schema at `create`). A module whose slots fail validation is skipped with a
 * warning. Idempotent: route mounting rebuilds from the frozen base each call, and
 * editor/XML registration replace-by-name / set-add, so the sync built-in mount
 * and the later async plugin mount (and hot-reloads) never accumulate state.
 */

import { registerEditorExtension, ALL_EDITOR_CONTEXTS } from './registry.js';
import { registerXmlEntityType } from './extensions/xmlNodes.js';
import type { FrontendModule, StateSliceContribution } from '../core/plugin-host/types.js';
import { validateFrontendModule } from '../runtime/validate-slots.js';
import {
  rootRoute,
  rebuildRouteTree,
  BASE_ROUTE_CHILDREN,
  type AppRouter,
} from '../router.js';
import type { AnyRoute } from '@tanstack/react-router';

/** The original `path` a route was created with (used for dedup). */
function routePath(route: { path?: string; fullPath?: string }): string | undefined {
  return route.path ?? route.fullPath;
}

/**
 * Phase 3 — typed but UNCONSUMED state-slice registration point. There is no host
 * store mechanism yet (see the `stateSlice` patch); this only records the slice
 * so a later consumer can drain it, and warns on a duplicate key.
 */
const stateSlices = new Map<string, StateSliceContribution>();
function registerStateSlice(slice: StateSliceContribution): void {
  if (stateSlices.has(slice.key)) {
    console.warn(`[plugin-host] duplicate stateSlice key "${slice.key}" — keeping the first`);
    return;
  }
  stateSlices.set(slice.key, slice);
}

export function mountFrontend(router: AppRouter, modules: FrontendModule[]): void {
  // Stable, deterministic order: low displayOrder first (first-wins on route dups).
  const ordered = [...modules].sort((a, b) => a.displayOrder - b.displayOrder);

  // Seed the seen-paths set from the host's static base routes so a plugin can
  // never shadow a built-in host route (the host wins for base paths).
  const seenPaths = new Set<string>();
  for (const base of BASE_ROUTE_CHILDREN) {
    const p = routePath(base);
    if (p) seenPaths.add(p);
  }

  const pluginRoutes: AnyRoute[] = [];

  for (const m of ordered) {
    const validation = validateFrontendModule(m);
    if (!validation.ok) {
      console.warn(
        `[plugin-host] skipping frontend slots for "${m.type}" — ${validation.reason}`,
      );
      continue;
    }

    // Auto-allow `<type .../>` as an inline + block XML embed in prose.
    registerXmlEntityType(m.type);

    // Pin the plugin's editor extensions onto the shared Tiptap registry.
    for (const ext of m.editorExtensions ?? []) {
      const badContext = (ext.availableIn ?? []).find((c) => !ALL_EDITOR_CONTEXTS.includes(c));
      if (badContext) {
        console.warn(
          `[plugin-host] editor extension "${ext.name}" from "${m.type}" targets unknown context "${badContext}" — skipped`,
        );
        continue;
      }
      try {
        registerEditorExtension(ext);
      } catch (err) {
        console.warn(
          `[plugin-host] editor extension "${ext.name}" from "${m.type}" failed to register: ${
            (err as Error).message
          }`,
        );
      }
    }

    // Phase 3 — collect this module's page routes, deduped by path (first wins).
    if (m.routes) {
      let contributed: AnyRoute[] = [];
      try {
        contributed = m.routes({ rootRoute });
      } catch (err) {
        console.warn(
          `[plugin-host] routes() for "${m.type}" threw — skipping its routes: ${(err as Error).message}`,
        );
      }
      for (const route of contributed) {
        const p = routePath(route);
        if (p && seenPaths.has(p)) {
          console.warn(
            `[plugin-host] route "${p}" from "${m.type}" duplicates an already-mounted route — skipped`,
          );
          continue;
        }
        if (p) seenPaths.add(p);
        pluginRoutes.push(route);
      }
    }

    // Phase 3 — acknowledge the optional state slice (no consumer yet).
    if (m.stateSlice) registerStateSlice(m.stateSlice);
  }

  // Rebuild the router's route tree as BASE ∪ collected plugin routes.
  rebuildRouteTree(router, pluginRoutes);
}
