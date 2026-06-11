import Database from 'better-sqlite3';
import { runMigrations } from '../../src/server/db/migrate.js';

export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}
