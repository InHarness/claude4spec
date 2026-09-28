import type { IncomingMessage } from 'node:http';
import type { RequestHandler } from 'express';
import {
  effectivePublicUrl,
  isLoopbackHost,
  isWildcardHost,
  type WorkspaceNetwork,
} from '../../core/workspace/network.js';

/**
 * 2.1.0 (M49) — browser barriers in front of an UNAUTHENTICATED server. Both run
 * BEFORE any route and before the project key is read, for plain requests and
 * for the WebSocket upgrade alike.
 *
 *  1. Host allowlist — a request whose `Host` is not the `publicUrl` host, a
 *     loopback name or a concrete (non-wildcard) `bindHost` is refused
 *     (DNS-rebinding guard). Hostnames are compared, ports are not: a reverse
 *     proxy may forward a different port.
 *  2. Origin check — a MUTATING request, or a WS upgrade, carrying an `Origin`
 *     other than the `publicUrl` origin or a loopback / `bindHost` origin is refused, so a
 *     foreign page cannot drive the API from a victim's browser. A request with
 *     no `Origin` (CLI, curl, MCP clients) is not a cross-site browser request
 *     and passes.
 *
 * Allowed values are read from the live workspace record on every request.
 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** `Host` header → lowercase hostname without port (IPv6 keeps its brackets off). */
function hostnameOf(hostHeader: string): string | null {
  const h = hostHeader.trim().toLowerCase();
  if (h === '') return null;
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 0 ? h.slice(1, end) : null;
  }
  const colon = h.indexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

const stripBrackets = (h: string): string => h.replace(/^\[|\]$/g, '').toLowerCase();

/** The effective publicUrl, or `null` when a hand-edited stored value does not parse. */
function publicUrlOf(ws: WorkspaceNetwork): URL | null {
  try {
    return new URL(effectivePublicUrl(ws));
  } catch {
    return null; // a malformed stored publicUrl admits nothing; loopback still works
  }
}

/**
 * Loopback names, and a CONCRETE `bindHost`: `localServerUrl` hands that
 * address to the launcher's browser and to `c4s` discovery, so refusing it
 * would lock the local user out of their own server.
 */
function isLocalName(name: string, ws: WorkspaceNetwork): boolean {
  if (isLoopbackHost(name)) return true;
  return !isWildcardHost(ws.bindHost) && stripBrackets(ws.bindHost!) === name;
}

export function isAllowedHost(hostHeader: string | undefined, ws: WorkspaceNetwork): boolean {
  if (!hostHeader) return false;
  const name = hostnameOf(hostHeader);
  if (!name) return false;
  const pub = publicUrlOf(ws);
  return isLocalName(name, ws) || (pub !== null && stripBrackets(pub.hostname) === name);
}

export function isAllowedOrigin(origin: string | undefined, ws: WorkspaceNetwork): boolean {
  if (origin === undefined) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // `null` (opaque origin) and garbage are refused
  }
  if (url.origin === publicUrlOf(ws)?.origin) return true;
  return (url.protocol === 'http:' || url.protocol === 'https:') && isLocalName(stripBrackets(url.hostname), ws);
}

export type GuardVerdict = { ok: true } | { ok: false; status: 400 | 403; code: string; message: string };

/** One verdict for a request (or an upgrade — `mutating` then means "always check Origin"). */
export function checkRequest(
  req: Pick<IncomingMessage, 'headers'>,
  ws: WorkspaceNetwork,
  opts: { checkOrigin: boolean },
): GuardVerdict {
  const host = req.headers.host;
  if (!isAllowedHost(host, ws)) {
    return {
      ok: false,
      status: host ? 403 : 400,
      code: 'HOST_NOT_ALLOWED',
      message: host
        ? `Host '${host}' is not allowed — set --public-url to the address clients use`
        : 'missing Host header',
    };
  }
  if (opts.checkOrigin) {
    const origin = req.headers.origin;
    if (!isAllowedOrigin(typeof origin === 'string' ? origin : undefined, ws)) {
      return { ok: false, status: 403, code: 'ORIGIN_NOT_ALLOWED', message: `Origin '${String(origin)}' is not allowed` };
    }
  }
  return { ok: true };
}

export function hostOriginGuard(getWorkspace: () => WorkspaceNetwork): RequestHandler {
  return (req, res, next) => {
    const verdict = checkRequest(req, getWorkspace(), { checkOrigin: MUTATING_METHODS.has(req.method) });
    if (verdict.ok) return next();
    res.status(verdict.status).json({ error: { code: verdict.code, message: verdict.message } });
  };
}
