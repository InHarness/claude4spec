import { stripBase } from '../lib/api-core.js';

/**
 * 0.2.110 M05 — the in-app route an agent-reply link points at, when it points
 * at an entity route (`/endpoints/get-users`, `/acs`, …), else `null`.
 *
 * Accepts a project-relative path, the same path under this project's `/p/<id>`
 * basepath, or a same-origin absolute URL. A link is an entity route when its
 * first segment is an ACTIVE type's `pathPrefix` — the prefixes come from the
 * caller (the client plugin host), so no type is named here.
 */
export function entityRouteHref(
  href: string,
  pathPrefixes: readonly string[],
  origin: string = typeof window === 'undefined' ? '' : window.location.origin,
): string | null {
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
  const query = pathname.includes('?') ? `?${pathname.split('?')[1]}` : '';
  return route + query + (hashParts.length ? `#${hashParts.join('#')}` : '');
}
