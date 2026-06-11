import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { runMigrations } from './migrate.js';
import { backfillPlanTitles } from './fixups/backfill-plan-titles.js';
import { slotDirFor } from '../workspace/registry.js';
import { projectIdForCwd } from '../workspace/project-id.js';
import type { WorkspaceRecord } from '../workspace/types.js';

export interface Db {
  handle: Database.Database;
  close: () => void;
}

/**
 * M31: the derived SQLite lives OUTSIDE the project dir, in the workspace slot
 * `~/.claude4spec/<workspace>/<project-id>/db.sqlite` — the same cwd can carry
 * an independent index per workspace.
 */
export function openDb(workspace: WorkspaceRecord, cwd: string): Db {
  const dir = slotDirFor(workspace.name, projectIdForCwd(cwd));
  fs.mkdirSync(dir, { recursive: true });
  return openDbAt(path.join(dir, 'db.sqlite'));
}

export function openDbAt(dbPath: string): Db {
  const handle = new Database(dbPath);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');

  const applied = runMigrations(handle);
  if (applied.length) {
    console.log(`  migrations applied: ${applied.join(', ')}`);
  }

  const titlesBackfilled = backfillPlanTitles(handle);
  if (titlesBackfilled > 0) {
    console.log(`  plan titles backfilled: ${titlesBackfilled}`);
  }

  return {
    handle,
    close: () => handle.close(),
  };
}
