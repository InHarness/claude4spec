import { effectivePublicUrl } from '../../core/workspace/network.js';
import { byLastOpenedDesc, WorkspaceRegistry } from './registry.js';
import type { WorkspaceRecord } from './types.js';

/**
 * M31 / L2 — one row of `c4s list-workspaces` (record `list-workspaces`,
 * `returns`; M31 `459ucmfg`).
 *
 * Deliberately NOT a `WorkspaceRecord`: `projects[]` stays collapsed to its
 * length, because the expanded project list is the separate catalog operation
 * `list_projects` and the two are kept disjoint. `plugins[]` is absent for a
 * different reason — it is load configuration, not workspace identity.
 */
export interface WorkspaceSummary {
  name: string;
  /** `registry` — composition in the entry; `home` — in `<home>/.claude4spec/workspace.json`. */
  kind: 'registry' | 'home';
  /** The home directory — only on a `home` row. */
  home?: string;
  mode: WorkspaceRecord['mode'];
  defaultPort: number;
  /** The listen address the entry stores; absent = loopback. */
  bindHost?: string;
  /** The EFFECTIVE public address (`http://localhost:<defaultPort>` when none is stored). */
  publicUrl: string;
  /**
   * `projects.length` of a registry entry, or the number of entries in
   * `workspace.json` — the count only, never the list. `null` whenever `state`
   * is not `ok`: there is no composition to count.
   */
  projectCount: number | null;
  /** ISO-8601 of the last open. Absent on a workspace never opened. */
  lastOpened?: string;
  /**
   * `ok`; `home-missing` — the home directory does not exist on this machine;
   * `workspace-file-invalid` — its `workspace.json` is unreadable or off the
   * shape (the refusal the start of that workspace gets).
   */
  state: 'ok' | 'home-missing' | 'workspace-file-invalid';
}

/**
 * The registry could not be read at all. Distinct from "there is nothing to
 * read": a missing file is an empty registry, not a failure.
 */
export class WorkspaceRegistryReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceRegistryReadError';
  }
}

/**
 * Server-free read of `~/.claude4spec/workspaces.json` together with the
 * `workspace.json` of every registered home (mode `registry-read`).
 *
 * Takes NO advisory lock. The lock exists for the read-modify-write paths
 * (`setProjectTrust` and friends), where a concurrent writer could lose an
 * update; a whole-file read has nothing to lose to a race, and taking the lock
 * would make the one command you run BEFORE starting a server block on a server
 * that is starting.
 *
 * No file → `[]`. The file is not created, nor is `~/.claude4spec/` — the same
 * laziness `install-skills` applies to its target directory. Anything else that
 * stops the file from being read (invalid JSON, a shape that is not a registry,
 * a schema version from a newer binary, `EACCES`) throws
 * `WorkspaceRegistryReadError` with NO partial result: the file is parsed in one
 * piece, and half the workspaces would be a worse answer than none. A broken
 * `workspace.json` of one home is NOT such a failure: it concerns one row only.
 */
export function listWorkspaces(registry: WorkspaceRegistry = new WorkspaceRegistry()): WorkspaceSummary[] {
  let records: WorkspaceRecord[];
  try {
    records = registry.listWorkspaces();
  } catch (err) {
    // The parse/shape failures already name the file; an `EACCES` from
    // `readFileSync` does too. Anything else gets the path prefixed, so the
    // message always says WHICH registry could not be read.
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkspaceRegistryReadError(
      message.includes(registry.filePath) ? message : `${registry.filePath}: ${message}`,
    );
  }

  // A row whose composition cannot be read keeps its registry attributes and
  // says why in `state`; the refusal of a broken file (what to fix in which
  // file) also goes to stderr — the other rows stay a complete answer.
  for (const w of records) {
    if (w.fileError && !w.homeMissing) console.warn(`[workspace] "${w.name}": ${w.fileError.message}`);
  }

  const rows = records.map<WorkspaceSummary>((w) => {
    const state: WorkspaceSummary['state'] = w.homeMissing
      ? 'home-missing'
      : w.fileError
        ? 'workspace-file-invalid'
        : 'ok';
    return {
      name: w.name,
      kind: w.home !== undefined ? 'home' : 'registry',
      ...(w.home !== undefined ? { home: w.home } : {}),
      mode: w.mode,
      defaultPort: w.defaultPort,
      ...(w.bindHost !== undefined ? { bindHost: w.bindHost } : {}),
      publicUrl: effectivePublicUrl(w),
      projectCount: state === 'ok' ? w.projects.length : null,
      ...(w.lastOpened !== undefined ? { lastOpened: w.lastOpened } : {}),
      state,
    };
  });

  // Most-recently-opened first, never-opened last in registry order — the same
  // helper the bare-start workspace pick uses, so the two orderings cannot
  // disagree about where a workspace with no timestamp belongs.
  return byLastOpenedDesc(rows);
}
