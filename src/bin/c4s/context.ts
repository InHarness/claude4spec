import path from 'node:path';
import { openDbReadonly, ReadonlyDbError } from '../../server/db/readonly.js';
import { RawEntityReader } from '../../server/discovery/raw-entity-reader.js';
import type { SerializationEngine } from '../../server/core/plugin-host/serialization-engine.js';
import { createDiscoveryCore, type DiscoveryCore } from '../../server/discovery/index.js';
import { buildCliSerializationEngineAsync } from '../../server/core/plugin-host/cli-engine.js';
import {
  resolveWorkspaceProject,
  WorkspaceResolveError,
  type ResolvedWorkspaceProject,
} from '../../core/workspace/resolve.js';
import { readConfig } from '../../server/config.js';
import type { Root } from '../../shared/types.js';
import { readPackageVersion } from './package-version.js';
import { CliError } from './errors.js';
import { optionalString, type ParsedArgs } from './args.js';

export interface CliContext {
  projectDir: string;
  reader: RawEntityReader;
  registry: SerializationEngine;
  /**
   * M39: the CLI is a TRANSPORT over the discovery core. It resolves the
   * project and the db slot, calls an operation, and prints the result — it
   * does not serialize entities or iterate types itself.
   */
  discovery: DiscoveryCore;
  db: import('better-sqlite3').Database;
  close: () => void;
}

export { buildCliSerializationEngineAsync };

/** Maps a caught `WorkspaceResolveError` onto the CLI error surface; rethrows anything else. */
export function mapWorkspaceResolveError(err: unknown): never {
  if (err instanceof WorkspaceResolveError) {
    throw new CliError(err.code, err.message, err.hint);
  }
  throw err;
}

/**
 * Registry-only resolution (no db.sqlite open) for commands that must work
 * under `INDEX_NOT_MATERIALIZED` — e.g. `list-briefs`/`read-brief`/`file-patch`
 * (M11), which only need `projectDir` to locate `briefsDir`/`patchesDir` from
 * `config.json`.
 */
export function resolveWorkspaceProjectOrThrow(args: {
  project?: string;
  workspace?: string;
}): ResolvedWorkspaceProject {
  try {
    return resolveWorkspaceProject({ project: args.project, workspace: args.workspace });
  } catch (err) {
    mapWorkspaceResolveError(err);
  }
}

/**
 * Shared by `list-briefs`/`read-brief`/`file-patch` — resolves the project,
 * then the absolute `briefsDir`/`patchesDir` from its `config.json`, in one
 * call instead of each command repeating resolve→readConfig→path.resolve.
 */
export function resolveBriefsPatchesDirs(args: {
  project?: string;
  workspace?: string;
}): { projectDir: string; briefsDirAbs: string; patchesDirAbs: string } {
  const { projectDir } = resolveWorkspaceProjectOrThrow(args);
  const config = readConfig(projectDir);
  return {
    projectDir,
    briefsDirAbs: path.resolve(projectDir, config.briefsDir),
    patchesDirAbs: path.resolve(projectDir, config.patchesDir),
  };
}

/**
 * `--pages <dir>` overrides the `dir` of the BUILT-IN root, and nothing else.
 *
 * 0.2.6 moved this out of `find-references`, which used to build its own root
 * list and walk it. The override is a property of the project's root
 * configuration, so it belongs where the roots are assembled — that way the
 * discovery core does the walking, gates on root properties as it does for every
 * other transport, and no command needs an `if (dir === 'pages')` branch of its
 * own.
 */
function applyPagesOverride(roots: readonly Root[], override: string | undefined): Root[] {
  if (!override) return [...roots];
  return roots.map((root) => (root.id === BUILTIN_PAGES_ROOT_ID ? { ...root, dir: override } : root));
}

const BUILTIN_PAGES_ROOT_ID = 'pages';

export async function createContext(args: ParsedArgs): Promise<CliContext> {
  let resolved;
  try {
    // M31: 0/1/N registry resolution BEFORE any db access.
    resolved = resolveWorkspaceProject({ project: args.project, workspace: args.workspace });
  } catch (err) {
    mapWorkspaceResolveError(err);
  }
  const projectDir = resolved.projectDir;
  try {
    const { handle, close } = openDbReadonly(resolved.dbPath);
    // M33: run the shared bootstrap loader so plugin-borne entity types appear
    // in CLI serialization exactly as on the server (phase 1: usually empty).
    const { engine: registry, host } = await buildCliSerializationEngineAsync(resolved.pluginPackages);
    const reader = new RawEntityReader(handle, host);
    return {
      projectDir,
      reader,
      registry,
      discovery: createDiscoveryCore({
        reader,
        db: handle,
        host,
        serialization: registry,
        roots: applyPagesOverride(readConfig(projectDir).roots, optionalString(args, 'pages')),
        projectDir,
        packageVersion: readPackageVersion(),
      }),
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
