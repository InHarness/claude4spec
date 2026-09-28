import fs from 'node:fs';
import path from 'node:path';
import { legacyHashId } from './project-id.js';

/**
 * M31 slot continuity (2.1.0): a DB slot records the directory it was created
 * for, so a detached project re-registered from the same directory recovers
 * its `id` and slot, while a NEW project that merely shares the name never
 * inherits someone else's slot. The record lives inside the slot itself —
 * `workspaces.json` keeps no tombstones — and purge (which deletes the slot)
 * frees the id.
 *
 * Legacy slots (created before 2.1.0, never migrated because their project was
 * detached at migration time) carry no marker; they are named `sha1(cwd)` and
 * are recognised by that name.
 */
export const SLOT_MARKER_FILE = 'slot.json';

interface SlotMarker {
  cwd: string;
}

export function writeSlotMarker(slotDir: string, cwd: string): void {
  fs.mkdirSync(slotDir, { recursive: true });
  const marker: SlotMarker = { cwd: path.resolve(cwd) };
  fs.writeFileSync(path.join(slotDir, SLOT_MARKER_FILE), JSON.stringify(marker, null, 2) + '\n', 'utf8');
}

export function readSlotMarker(slotDir: string): SlotMarker | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(slotDir, SLOT_MARKER_FILE), 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as SlotMarker).cwd === 'string') {
      return { cwd: (parsed as SlotMarker).cwd };
    }
  } catch {
    /* absent or unreadable marker */
  }
  return null;
}

/** Names of every slot directory under one workspace directory (`~/.claude4spec/<ws>/`). */
export function listSlotIds(workspaceDir: string): string[] {
  try {
    return fs
      .readdirSync(workspaceDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * The id of the slot that belongs to `cwd` in this workspace directory, or
 * `null`. A marker match wins; a marker-less directory named `sha1(cwd)` is the
 * legacy slot of that directory.
 */
export function findSlotIdForCwd(workspaceDir: string, cwd: string): string | null {
  const target = path.resolve(cwd);
  const ids = listSlotIds(workspaceDir);
  for (const id of ids) {
    const marker = readSlotMarker(path.join(workspaceDir, id));
    if (marker && path.resolve(marker.cwd) === target) return id;
  }
  const legacy = legacyHashId(target);
  if (ids.includes(legacy) && readSlotMarker(path.join(workspaceDir, legacy)) === null) return legacy;
  return null;
}
