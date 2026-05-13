import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { runMigrations } from './migrate.js';
import { backfillPlanTitles } from './fixups/backfill-plan-titles.js';

export interface Db {
  handle: Database.Database;
  close: () => void;
}

export function openDb(cwd: string): Db {
  const dir = path.join(cwd, '.claude4spec');
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'db.sqlite');
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
