/**
 * A full document load to `href`. Used after workspace-registry changes (add /
 * detach / purge a project): PROJECT_ID / API_BASE / the router basepath are
 * module-load constants, so a client-side navigation would keep the old project.
 *
 * One function, its own module: the callers stay testable (tests mock this
 * module instead of fighting a non-configurable `window.location`).
 */
export function navigateDocument(href: string): void {
  window.location.href = href;
}
