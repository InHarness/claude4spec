import path from 'node:path';
import { mintProjectId } from './project-id.js';
import { listSlotIds, readSlotMarker } from './slot-marker.js';
import type { WorkspacesFile } from './types.js';

/**
 * 2.1.0 (M31 edge): the one-way registry migration from hash ids
 * (`sha1(cwd).slice(0,12)`, schema ≤ 2) to readable ids (schema 3).
 *
 * Detection is by schema version, not by the shape of an id: every project of
 * a schema-≤2 registry has a hash id by construction, whereas a readable id
 * may legitimately look like hex.
 */
export const READABLE_IDS_SCHEMA_VERSION = 3;

/** Pre-2.1.0 record shape: carried a `name` slug (`basename(cwd)`). */
interface LegacyProjectFields {
  name?: string;
}

export interface ProjectIdRename {
  workspace: string;
  cwd: string;
  from: string;
  to: string;
}

export function isMigrationPendingFor(data: WorkspacesFile): boolean {
  return (
    (typeof data.$schemaVersion !== 'number' || data.$schemaVersion < READABLE_IDS_SCHEMA_VERSION) &&
    data.workspaces.some((w) => w.projects.length > 0)
  );
}

/**
 * Pure plan: the migrated registry plus the list of id renames. The new id is
 * minted from the record's old slug (`name`, else the directory name) with the
 * regular minting rule; it must avoid the ids already assigned in the same
 * workspace AND every existing slot directory except the project's own hash
 * slot (a detached project's legacy slot keeps its name reserved).
 *
 * Used twice: by the server (`WorkspaceRegistry.migrateIfNeeded`, which then
 * renames slot directories and writes the file) and by read-only CLI commands,
 * which compute the new ids in memory and never write.
 */
export function planRegistryMigration(
  data: WorkspacesFile,
  baseDir: string,
): { file: WorkspacesFile; renames: ProjectIdRename[] } {
  const renames: ProjectIdRename[] = [];
  const workspaces = data.workspaces.map((ws) => {
    const slotIds = listSlotIds(path.join(baseDir, ws.name));
    const hashIds = new Set(ws.projects.map((p) => p.id));
    const assigned = new Set<string>();
    const projects = ws.projects.map((p) => {
      const { name, ...rest } = p as typeof p & LegacyProjectFields;
      const taken = new Set<string>([...assigned, ...slotIds.filter((s) => s !== p.id && !hashIds.has(s))]);
      // A still-registered sibling's hash slot is about to be renamed away, but
      // it must not collide with a readable id either — it is hex, so it only
      // could if the slug itself were that exact hex string. Guard anyway.
      for (const h of hashIds) if (h !== p.id) taken.add(h);
      // Resuming an interrupted migration: the marker is written into the hash
      // slot BEFORE the rename, so a renamed slot always names its directory —
      // "hash id without a slot, target slot present" ⇒ adopt that target.
      const resumed = slotIds.find(
        (s) =>
          s !== p.id &&
          !hashIds.has(s) &&
          !assigned.has(s) &&
          readSlotMarker(path.join(baseDir, ws.name, s))?.cwd === path.resolve(p.cwd),
      );
      const id = resumed ?? mintProjectId(name && name.trim() !== '' ? name : path.basename(p.cwd), taken);
      assigned.add(id);
      renames.push({ workspace: ws.name, cwd: p.cwd, from: p.id, to: id });
      return { ...rest, id };
    });
    return { ...ws, projects };
  });
  return { file: { $schemaVersion: READABLE_IDS_SCHEMA_VERSION, workspaces }, renames };
}
