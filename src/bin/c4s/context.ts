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
 * `--pages <dir>` NARROWS the walk to that one directory.
 *
 * 0.2.6 moved this out of `find-references`, which used to build its own root
 * list and walk it. The override is a property of the project's root
 * configuration, so it belongs where the roots are assembled — the discovery
 * core then does the walking and gates on root properties, and no command needs
 * an `if (dir === 'pages')` branch of its own.
 *
 * It REPLACES the root list rather than rewriting one entry, which is what the
 * flag has always meant. Rewriting the built-in root's `dir` and leaving the
 * others in place looks equivalent and is not: a caller that explicitly narrowed
 * the scan would still get hits from every other reference-validated root, with
 * paths relative to a root it never named — and pointing a second root id at a
 * directory another root already covers slips past the overlap validation in
 * `validateRootsConfig`, so every hit there is reported twice under two ids.
 *
 * The root's ID and properties are kept: the override names a DIRECTORY, not a
 * root, so the hits stay attributable to whichever root claims that directory
 * (falling back to the built-in id when none does).
 */
function applyPagesOverride(roots: readonly Root[], override: string | undefined): Root[] {
  if (!override) return [...roots];
  const owning = roots.find((r) => r.dir === override);
  if (owning) return [owning];
  const builtin = roots.find((r) => r.id === BUILTIN_PAGES_ROOT_ID) ?? roots[0];
  if (!builtin) return [];
  return [{ ...builtin, dir: override }];
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
