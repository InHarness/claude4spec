import { RegistryMigrationPendingError, WorkspaceRegistry } from './registry.js';

/**
 * 2.1.67 — M31 core of `c4s register-home` (record `register-home`, mode
 * `registry-write`): register an EXISTING workspace home in the global
 * registry without a server. The whole rule lives in
 * `WorkspaceRegistry.registerHome` (M31 `zktorogu`); this wrapper adds only
 * what the CLI path needs on top of it — the refusal of a registry still
 * carrying pre-2.1.0 hash ids (only the server migrates) — and shapes the
 * record's `returns`.
 *
 * Refusals, all before anything is written: `RegistryMigrationPendingError`,
 * `RegisterHomeError` (`INVALID_ARGS`, `WORKSPACE_FILE_MISSING`,
 * `WORKSPACE_FILE_INVALID`) and `WorkspaceSelectionError` (`CWD_IS_PROJECT`,
 * `CWD_INSIDE_HOME`, `WORKSPACE_HOME_MISMATCH`, `PORT_TAKEN_BY_WORKSPACE`).
 */
export interface RegisterHomeCommandResult {
  workspace: string;
  home: string;
  defaultPort: number;
  created: boolean;
}

export function registerHomeDirectory(
  opts: { cwd: string; name?: string; port?: number; userHome?: string },
  registry: WorkspaceRegistry = new WorkspaceRegistry(),
): RegisterHomeCommandResult {
  if (registry.isMigrationPending()) throw new RegistryMigrationPendingError(registry.filePath);
  const { entry, created } = registry.registerHome(opts.cwd, {
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    ...(opts.port !== undefined ? { port: opts.port } : {}),
    ...(opts.userHome !== undefined ? { userHome: opts.userHome } : {}),
  });
  return { workspace: entry.name, home: entry.home!, defaultPort: entry.defaultPort, created };
}
