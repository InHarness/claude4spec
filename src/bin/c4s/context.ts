import { openDbReadonly, ReadonlyDbError } from '../../server/db/readonly.js';
import { RawEntityReader } from '../../server/domain/raw-entity-reader.js';
import type { SerializationEngine } from '../../server/core/plugin-host/serialization-engine.js';
import { buildCliSerializationEngineAsync } from '../../server/core/plugin-host/cli-engine.js';
import {
  resolveWorkspaceProject,
  WorkspaceResolveError,
  type ResolvedWorkspaceProject,
} from '../../core/workspace/resolve.js';
import { CliError } from './errors.js';
import type { ParsedArgs } from './args.js';

export interface CliContext {
  projectDir: string;
  reader: RawEntityReader;
  registry: SerializationEngine;
  db: import('better-sqlite3').Database;
  close: () => void;
}

export { buildCliSerializationEngineAsync };

/**
 * Registry-only resolution (no db.sqlite open) for commands that must work
 * under `INDEX_NOT_MATERIALIZED` — e.g. `list-briefs`/`read-brief`/`file-patch`
 * (M11), which only need `projectDir` to locate `briefsDir`/`patchesDir` from
 * `config.json`. Shares the `WorkspaceResolveError` → `CliError` mapping
 * `createContext` uses below (also duplicated inline in `commands/plugins.ts`).
 */
export function resolveWorkspaceProjectOrThrow(args: {
  project?: string;
  workspace?: string;
}): ResolvedWorkspaceProject {
  try {
    return resolveWorkspaceProject({ project: args.project, workspace: args.workspace });
  } catch (err) {
    if (err instanceof WorkspaceResolveError) {
      throw new CliError(err.code, err.message, err.hint);
    }
    throw err;
  }
}

export async function createContext(args: ParsedArgs): Promise<CliContext> {
  let resolved;
  try {
    // M31: 0/1/N registry resolution BEFORE any db access.
    resolved = resolveWorkspaceProject({ project: args.project, workspace: args.workspace });
  } catch (err) {
    if (err instanceof WorkspaceResolveError) {
      throw new CliError(err.code, err.message, err.hint);
    }
    throw err;
  }
  const projectDir = resolved.projectDir;
  try {
    const { handle, close } = openDbReadonly(resolved.dbPath);
    const reader = new RawEntityReader(handle);
    // M33: run the shared bootstrap loader so plugin-borne entity types appear
    // in CLI serialization exactly as on the server (phase 1: usually empty).
    const registry = await buildCliSerializationEngineAsync(resolved.pluginPackages);
    return {
      projectDir,
      reader,
      registry,
      db: handle,
      close,
    };
  } catch (err) {
    if (err instanceof ReadonlyDbError) {
      throw new CliError(err.code, err.message, err.hint);
    }
    throw err;
  }
}
