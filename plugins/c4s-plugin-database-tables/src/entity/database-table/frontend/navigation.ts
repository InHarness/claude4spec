/**
 * M05 — route-level navigation helpers for this module's own screens.
 *
 * This resolves the router path for an entity `type` + `slug` and is DISTINCT from
 * `editorBridge.openEntity` (`@c4s/plugin-runtime`): the bridge is the host
 * singleton for cross-surface / cross-plugin navigation, whereas this stays inside
 * the plugin's `RouteTreeFragment` and never crosses the Host API boundary. The
 * detail-route prefix is resolved HERE (not inlined at call sites) so a derived
 * plugin with several entity types extends one map instead of hunting for
 * `\`${PREFIX}/$slug\`` template literals.
 *
 * The `@tanstack/react-router` boundary is intentionally opaque in the Host API
 * (`RouteTreeFragment` works with `AnyRoute = unknown`), so `Navigate` is a loose
 * structural view of the router's `navigate`.
 */

import { DATABASE_TABLE_PATH_PREFIX, DATABASE_TABLE_TYPE } from '../../../identity.js';

/** Loose-typed view of the host router's `navigate` (routes are opaque in the contract). */
export type Navigate = (opts: { to: string; params?: Record<string, string>; replace?: boolean }) => void;

/** Router mount prefix per entity `type`. A derived plugin adds its own types here. */
const PATH_PREFIX_BY_TYPE: Record<string, string> = {
  [DATABASE_TABLE_TYPE]: DATABASE_TABLE_PATH_PREFIX,
};

/**
 * Navigate to an entity's detail screen (`<prefix>/:slug`) by `type` + `slug`.
 * `replace` swaps the history entry (used after a rename so Back does not return to
 * the stale slug). Unknown types throw — a misconfigured route is a bug, not a silent no-op.
 */
export function navigateToEntity(
  navigate: Navigate,
  type: string,
  slug: string,
  opts?: { replace?: boolean },
): void {
  const prefix = PATH_PREFIX_BY_TYPE[type];
  if (!prefix) throw new Error(`navigateToEntity: unknown entity type "${type}"`);
  navigate({ to: `${prefix}/$slug`, params: { slug }, replace: opts?.replace });
}

/**
 * Navigate to an entity's history screen (`<prefix>/:slug/history`) by `type` + `slug`.
 * Same `replace` semantics as `navigateToEntity` — pass `{ replace: true }` after a
 * restore so Back does not return to the stale history view.
 */
export function navigateToEntityHistory(
  navigate: Navigate,
  type: string,
  slug: string,
  opts?: { replace?: boolean },
): void {
  const prefix = PATH_PREFIX_BY_TYPE[type];
  if (!prefix) throw new Error(`navigateToEntityHistory: unknown entity type "${type}"`);
  navigate({ to: `${prefix}/$slug/history`, params: { slug }, replace: opts?.replace });
}
