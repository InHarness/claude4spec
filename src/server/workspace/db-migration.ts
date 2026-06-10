import fs from 'node:fs';
import path from 'node:path';
import { projectIdForCwd } from './project-id.js';
import { slotDirFor, type WorkspaceRegistry } from './registry.js';
import type { WorkspaceRecord } from './types.js';

function moveFile(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    // EXDEV: project dir and ~/.claude4spec on different volumes — copy+unlink.
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

/**
 * M31 first-registration hook: a pre-workspace project keeps its derived index
 * at `<cwd>/.claude4spec/db.sqlite`. If NO workspace anywhere owns a populated
 * slot for this project-id yet, the legacy DB (+ WAL sidecars) moves to
 * `~/.claude4spec/<ws>/<id>/db.sqlite`. A second workspace registering the
 * same cwd later starts with an empty slot (the index is derived — it rebuilds
 * from the committed entity files at boot).
 */
export function migrateLegacyDbIfNeeded(
  registry: WorkspaceRegistry,
  ws: WorkspaceRecord,
  cwd: string,
): boolean {
  const legacyDb = path.join(cwd, '.claude4spec', 'db.sqlite');
  if (!fs.existsSync(legacyDb)) return false;

  const id = projectIdForCwd(cwd);
  for (const w of registry.listWorkspaces()) {
    if (fs.existsSync(path.join(slotDirFor(w.name, id), 'db.sqlite'))) return false;
  }

  const dest = registry.slotDir(ws, id);
  fs.mkdirSync(dest, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const src = legacyDb + suffix;
    if (fs.existsSync(src)) moveFile(src, path.join(dest, 'db.sqlite' + suffix));
  }
  console.log(`[workspace] db migrated: ${legacyDb} → ${path.join(dest, 'db.sqlite')}`);
  return true;
}
