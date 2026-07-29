/**
 * Router helpers shared by both types' route trees.
 *
 * `AnyRoute` is opaque in the Host API and TanStack's `useNavigate` is typed
 * against the host's own route tree, which a plugin cannot see — so navigation
 * is loosely typed here, once, instead of at each call site.
 */

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
