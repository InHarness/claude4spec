/**
 * Router helpers shared by both types' route trees.
 *
 * `AnyRoute` is opaque in the Host API and TanStack's `useNavigate` is typed
 * against the host's own route tree, which a plugin cannot see — so navigation
 * is loosely typed here, once, instead of at each call site.
 */

import { clientPluginHost } from '@c4s/plugin-runtime';

export type Navigate = (opts: Record<string, unknown>) => void;

export function toList(navigate: Navigate, pathPrefix: string): void {
  navigate({ to: pathPrefix });
}

export function toDetail(
  navigate: Navigate,
  pathPrefix: string,
  slug: string,
  opts?: { replace?: boolean },
): void {
  navigate({ to: `${pathPrefix}/$slug`, params: { slug }, ...opts });
}

export function toPage(navigate: Navigate, rootId: string, path: string): void {
  navigate({ to: '/space/$rootId/$', params: { rootId, _splat: path } });
}

/**
 * Navigate to ANY entity type, resolving its route prefix from the host — the
 * plugin equivalent of the host's own `navigateToEntity`.
 *
 * This package cannot hardcode the prefix: the targets are whatever an entity
 * chip in a description points at, which includes types contributed by packages
 * that do not exist yet. A type with no module (deactivated, or never installed)
 * resolves to nothing and the click is a no-op, which is what the host does too.
 *
 * `clientPluginHost.getEntity(...)` stays a METHOD call — it reads `this`, and
 * pulling it into a local to cast it once unbinds the receiver and throws on
 * first render. Guarded by `test/frontend/host-lookups.test.ts`.
 */
export function toEntity(navigate: Navigate, type: string, slug: string): void {
  const mod =
    clientPluginHost.getEntity(type) ?? clientPluginHost.getAvailable(type);
  if (!mod?.pathPrefix) return;
  toDetail(navigate, mod.pathPrefix, slug);
}

/** Navigate to a page anchor. `pages` is the host's default root for sections. */
export function toSection(
  navigate: Navigate,
  pagePath: string,
  anchor: string,
  rootId = 'pages',
): void {
  navigate({
    to: '/space/$rootId/$',
    params: { rootId, _splat: pagePath },
    hash: `anchor-${anchor}`,
  });
}
