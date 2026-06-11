import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/server/db/migrations'
);

/**
 * Stosuje migracje w kolejności do podanej (włącznie), żeby odtworzyć stan
 * sprzed konkretnej migracji. FK off na czas batcha — jak w runMigrations.
 */
function applyMigrationsUpTo(db: Database.Database, lastVersion: string): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  db.pragma('foreign_keys = OFF');
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
    if (version === lastVersion) break;
  }
}

function applyMigration(db: Database.Database, version: string): void {
  db.pragma('foreign_keys = OFF');
  db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, `${version}.sql`), 'utf-8'));
  db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
}

describe('migration 021_plans_n1 backfill', () => {
  it('[ac:ac-backfill-migracji-n-1-dla-ka-dego-stareg] backfills chat_thread.plan_id and last_seen_plan_version from old plan.thread_id (1:1)', () => {
    const db = new Database(':memory:');
    // Stan sprzed N:1: plan jeszcze trzyma thread_id (UNIQUE), chat_thread bez plan_id.
    applyMigrationsUpTo(db, '020_drop_plan_status');

    db.prepare("INSERT INTO chat_thread (id) VALUES ('t-alpha'), ('t-beta'), ('t-orphan')").run();
    // Każdy stary plan przypięty do swojego wątku, z własnym current_version.
    db.prepare("INSERT INTO plan (thread_id, content, current_version) VALUES ('t-alpha', '# Alpha', 3)").run();
    db.prepare("INSERT INTO plan (thread_id, content, current_version) VALUES ('t-beta', '# Beta', 7)").run();

    applyMigration(db, '021_plans_n1');
    db.pragma('foreign_keys = ON');

    const rows = db
      .prepare('SELECT id, plan_id, last_seen_plan_version FROM chat_thread ORDER BY id')
      .all() as Array<{ id: string; plan_id: number | null; last_seen_plan_version: number | null }>;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    // Każdy istniejący wątek z planem widzi swój plan i jego bieżącą wersję.
    const planByTitle = db.prepare('SELECT id, content FROM plan').all() as Array<{ id: number; content: string }>;
    const alphaPlanId = planByTitle.find((p) => p.content === '# Alpha')!.id;
    const betaPlanId = planByTitle.find((p) => p.content === '# Beta')!.id;

    expect(byId['t-alpha']).toEqual({ id: 't-alpha', plan_id: alphaPlanId, last_seen_plan_version: 3 });
    expect(byId['t-beta']).toEqual({ id: 't-beta', plan_id: betaPlanId, last_seen_plan_version: 7 });

    // Wątek bez planu zostaje bez powiązania.
    expect(byId['t-orphan']).toEqual({ id: 't-orphan', plan_id: null, last_seen_plan_version: null });

    db.close();
  });
});
