/**
 * M31 reload contract (ic35jwy6), client side — "Synchronizacja UI = reload
 * route projektu (D2)". After the project's HEAD changed (own checkout / sync,
 * or `git:status-changed { headChanged: true }` from another client's
 * operation) the client re-enters the project route so every store, React Query
 * cache and the WS room re-scope onto the freshly rebuilt `ProjectContext`.
 *
 * One function, its own module: the callers stay testable (tests mock this
 * module instead of fighting a non-configurable `window.location`).
 */
export function reloadProjectRoute(): void {
  window.location.reload();
}
