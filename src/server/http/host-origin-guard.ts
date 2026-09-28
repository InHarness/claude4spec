import type { IncomingMessage } from 'node:http';
import type { RequestHandler } from 'express';
import { effectivePublicUrl, LOOPBACK_HOSTNAMES, type WorkspaceNetwork } from '../../core/workspace/network.js';

/**
 * 2.1.0 (M49) — browser barriers in front of an UNAUTHENTICATED server. Both run
 * BEFORE any route and before the project key is read, for plain requests and
 * for the WebSocket upgrade alike.
 *
 *  1. Host allowlist — a request whose `Host` is not the `publicUrl` host or a
 *     loopback name is refused (DNS-rebinding guard). Hostnames are compared,
 *     ports are not: a reverse proxy may forward a different port.
 *  2. Origin check — a MUTATING request, or a WS upgrade, carrying an `Origin`
 *     other than the `publicUrl` origin or a loopback origin is refused, so a
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

function allowedHostnames(ws: WorkspaceNetwork): Set<string> {
  const names = new Set(LOOPBACK_HOSTNAMES.map((n) => n.replace(/^\[|\]$/g, '')));
  try {
    names.add(new URL(effectivePublicUrl(ws)).hostname.replace(/^\[|\]$/g, '').toLowerCase());
  } catch {
    /* a malformed stored publicUrl adds nothing; loopback still works */
  }
  return names;
}

export function isAllowedHost(hostHeader: string | undefined, ws: WorkspaceNetwork): boolean {
  if (!hostHeader) return false;
  const name = hostnameOf(hostHeader);
  if (!name) return false;
  return allowedHostnames(ws).has(name) || /^127\.\d+\.\d+\.\d+$/.test(name);
}

export function isAllowedOrigin(origin: string | undefined, ws: WorkspaceNetwork): boolean {
  if (origin === undefined) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // `null` (opaque origin) and garbage are refused
  }
  if (url.origin === new URL(effectivePublicUrl(ws)).origin) return true;
  const name = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (url.protocol === 'http:' || url.protocol === 'https:') &&
    (LOOPBACK_HOSTNAMES.map((n) => n.replace(/^\[|\]$/g, '')).includes(name) || /^127\.\d+\.\d+\.\d+$/.test(name));
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
