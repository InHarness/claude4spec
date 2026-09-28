import {
  effectiveBindHost,
  isLoopbackHost,
  validatePublicUrl,
  type WorkspaceNetwork,
} from '../../core/workspace/network.js';
import type { WorkspaceRegistry } from './registry.js';
import type { WorkspaceRecord } from './types.js';

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

export function applyNetworkFlags(
  registry: WorkspaceRegistry,
  workspace: WorkspaceRecord,
  flags: NetworkFlags,
): WorkspaceRecord {
  let publicUrl = flags.publicUrl;
  if (publicUrl !== undefined && publicUrl !== '') {
    const checked = validatePublicUrl(publicUrl);
    if (!checked.ok) throw new InvalidPublicUrlError(checked.error);
    publicUrl = checked.origin;
  }
  const host = flags.host?.trim();
  if (host === undefined && publicUrl === undefined) return workspace;
  return (
    registry.setNetwork(workspace.name, {
      ...(host !== undefined ? { bindHost: host } : {}),
      ...(publicUrl !== undefined ? { publicUrl } : {}),
    }) ?? workspace
  );
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
