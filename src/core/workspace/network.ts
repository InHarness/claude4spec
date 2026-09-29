/**
 * 2.1.0 (M31/M49): which address serves which consumer.
 *
 *   local address  — loopback `:defaultPort`, or `bindHost` when it is a
 *                    concrete (non-wildcard) address. Browser auto-open and
 *                    `c4s` server discovery. Never `publicUrl`, so a reverse
 *                    proxy cannot lock the local CLI out.
 *   publicUrl      — what clients see; the only source of URLs handed out
 *                    (MCP snippets, external skills, links).
 */
export interface WorkspaceNetwork {
  defaultPort: number;
  bindHost?: string;
  publicUrl?: string;
}

export const LOOPBACK_BIND_HOST = '127.0.0.1';
export const LOOPBACK_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1', '::1', '[::1]'];
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]', '']);

/**
 * Loopback name or address. `127.x.y.z` must be a full dotted quad — a HOSTNAME
 * like `127.attacker.example` is not loopback (the Host guard relies on this).
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined || host === '') return true;
  const h = host.toLowerCase();
  return LOOPBACK_HOSTNAMES.includes(h) || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** `0.0.0.0` / `::` / empty — "all interfaces", not an address a client can use. */
export function isWildcardHost(host: string | undefined): boolean {
  return host === undefined || WILDCARD_HOSTS.has(host);
}

/** Address `listen()` binds to. */
export function effectiveBindHost(ws: WorkspaceNetwork): string {
  return ws.bindHost && ws.bindHost !== '' ? ws.bindHost : LOOPBACK_BIND_HOST;
}

export function effectivePublicUrl(ws: WorkspaceNetwork): string {
  return (ws.publicUrl && ws.publicUrl !== '' ? ws.publicUrl : `http://localhost:${ws.defaultPort}`).replace(/\/+$/, '');
}

export function localServerUrl(ws: WorkspaceNetwork): string {
  const bind = ws.bindHost;
  if (!bind || isWildcardHost(bind) || isLoopbackHost(bind)) return `http://localhost:${ws.defaultPort}`;
  const host = bind.includes(':') && !bind.startsWith('[') ? `[${bind}]` : bind;
  return `http://${host}:${ws.defaultPort}`;
}

/**
 * `--public-url` validation: absolute http/https URL with no path, query or
 * fragment. Returns the canonical origin, or an error message.
 */
export function validatePublicUrl(raw: string): { ok: true; origin: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: `--public-url "${raw}" is not an absolute URL` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: `--public-url "${raw}" must use http or https` };
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash || url.username || url.password) {
    return { ok: false, error: `--public-url "${raw}" must be an origin without a path (e.g. https://c4s.example.com)` };
  }
  return { ok: true, origin: url.origin };
}
