import {
  effectiveBindHost,
  effectivePublicUrl,
  isLoopbackHost,
  validatePublicUrl,
  type WorkspaceNetwork,
} from '../../core/workspace/network.js';
import type { WorkspaceRegistry } from './registry.js';

/**
 * 2.1.0 (M01) — `--host <addr>` / `--public-url <url>` are ATTRIBUTES of the
 * resolved workspace, not selectors: each given value overwrites the stored one
 * and persists in `~/.claude4spec/workspaces.json` (never `config.json`). An
 * empty value (`--host=`, `--public-url=`) restores the default (loopback /
 * `http://localhost:<defaultPort>`). `publicUrl` is validated BEFORE anything
 * is written — an invalid one refuses the start.
 */
export interface NetworkFlags {
  host?: string;
  publicUrl?: string;
}

export class InvalidPublicUrlError extends Error {}

export function applyNetworkFlags<W extends WorkspaceNetwork & { name: string }>(
  registry: WorkspaceRegistry,
  workspace: W,
  flags: NetworkFlags,
): W {
  let publicUrl = flags.publicUrl;
  if (publicUrl !== undefined && publicUrl !== '') {
    const checked = validatePublicUrl(publicUrl);
    if (!checked.ok) throw new InvalidPublicUrlError(checked.error);
    publicUrl = checked.origin;
  }
  const host = flags.host?.trim();
  if (host === undefined && publicUrl === undefined) return workspace;
  // The stored entry comes back (no view composed — no `workspace.json` read);
  // only its network attributes are carried onto the caller's record.
  const stored = registry.setNetwork(workspace.name, {
    ...(host !== undefined ? { bindHost: host } : {}),
    ...(publicUrl !== undefined ? { publicUrl } : {}),
  });
  if (!stored) return workspace;
  const next: W = { ...workspace };
  delete next.bindHost;
  delete next.publicUrl;
  if (stored.bindHost !== undefined) next.bindHost = stored.bindHost;
  if (stored.publicUrl !== undefined) next.publicUrl = stored.publicUrl;
  return next;
}

/**
 * The no-authentication warning, printed on EVERY start whose listen address is
 * not loopback (a non-loopback `bindHost` persists, so the warning must too).
 * `null` for a loopback start.
 */
export function noAuthWarning(ws: WorkspaceNetwork): string | null {
  const bind = effectiveBindHost(ws);
  if (isLoopbackHost(bind)) return null;
  return (
    `WARNING: claude4spec listens on ${bind}:${ws.defaultPort} and does NOT authenticate callers — ` +
    'anyone who can reach this address can read and change the specification. ' +
    'Restrict access at the network level (VPN, firewall, an authenticating reverse proxy) ' +
    'or restart with --host= to return to loopback.'
  );
}

/**
 * 2.1.12 (M31 `3l4ge8xa`) — the second start warning: a listen address beyond
 * loopback with NO explicit `publicUrl`. Every URL handed out (MCP connection
 * snippets, generated skills, links) is built from the effective `publicUrl`,
 * which then defaults to `http://localhost:<defaultPort>` — unreachable for the
 * clients the non-loopback listen exists for. `null` on loopback, or when
 * `publicUrl` is set.
 */
export function defaultPublicUrlWarning(ws: WorkspaceNetwork): string | null {
  if (isLoopbackHost(effectiveBindHost(ws))) return null;
  if (ws.publicUrl !== undefined && ws.publicUrl !== '') return null;
  return (
    `WARNING: claude4spec listens beyond loopback but no public URL is set — ` +
    `addresses handed out to clients (MCP connection snippets, generated skills, links) ` +
    `will point at ${effectivePublicUrl(ws)}, which clients outside this host cannot reach. ` +
    'Restart with --public-url <origin> to set the address clients should use.'
  );
}

/** Every warning a start prints for this workspace's network attributes, in order. */
export function startWarnings(ws: WorkspaceNetwork): string[] {
  return [noAuthWarning(ws), defaultPublicUrlWarning(ws)].filter((w): w is string => w !== null);
}
