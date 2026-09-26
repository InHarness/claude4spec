import { stripBase } from '../lib/api-core.js';

/**
 * 0.2.110 M05 — the in-app route an agent-reply link points at, when it points
 * at an entity route (`/endpoints/get-users`, `/acs`, …), else `null`. The
 * query and hash come back apart, as the router's `<Link>` takes them — a
 * `to` carrying `?…#…` would be matched as part of the pathname.
 *
 * Accepts a project-relative path, the same path under this project's `/p/<id>`
 * basepath, or a same-origin absolute URL. A link is an entity route when its
 * first segment is an ACTIVE type's `pathPrefix` — the prefixes come from the
 * caller (the client plugin host), so no type is named here.
 */
export interface EntityRouteTarget {
  to: string;
  search?: Record<string, string>;
  hash?: string;
}

export function entityRouteHref(
  href: string,
  pathPrefixes: readonly string[],
  origin: string = typeof window === 'undefined' ? '' : window.location.origin,
): EntityRouteTarget | null {
  let path = href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    if (!origin || !href.startsWith(`${origin}/`)) return null;
    path = href.slice(origin.length);
  }
  if (!path.startsWith('/')) return null;
  const [pathname = '', ...hashParts] = path.split('#');
  const route = stripBase(pathname.split('?')[0] ?? '');
  const hit = pathPrefixes.some((p) => route === p || route.startsWith(`${p}/`));
  if (!hit) return null;
  const target: EntityRouteTarget = { to: route };
  const query = pathname.includes('?') ? pathname.slice(pathname.indexOf('?') + 1) : '';
  if (query) target.search = Object.fromEntries(new URLSearchParams(query));
  if (hashParts.length) target.hash = hashParts.join('#');
  return target;
}
