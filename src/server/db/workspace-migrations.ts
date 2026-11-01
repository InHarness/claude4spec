import type Database from 'better-sqlite3';

/**
 * 2.1.64 (M41 `8eat4b2c`): the WORKSPACE-DB migration chain — the second,
 * separate chain, run by `openWorkspaceDb` against `workspace.sqlite` only.
 *
 * Same rules as the slot chain: idempotent (`IF NOT EXISTS`), additive, no
 * rollback, the list in one file, executed in order. It carries only AUTHORED
 * tables of workspace scope — no entity tables and no host tables of a project
 * slot — so it needs no baseline cut. The two chains never touch each other's
 * file: this list is never read by `runMigrations`, and `migrations/` is never
 * read here.
 *
 * Never rename or renumber a shipped entry: `version` is the ledger key in the
 * workspace DB's own `schema_migrations`.
 */
export interface WorkspaceMigration {
  version: string;
  sql: string;
}

export const WORKSPACE_MIGRATIONS: readonly WorkspaceMigration[] = [
  {
    // M55 `gsw1z1h3` — `remote_run`: which host to ask about a Run dispatched
    // from this workspace. PK `run_id` TEXT (a domain-meaningful ULID), no
    // other index, no FK (the host record lives in the workspace registry
    // file, not in a database). Append-only log: `created_at` is the only
    // audit column — the write-API is INSERT and DELETE, never UPDATE.
    version: '001_remote_run',
    sql: `
      CREATE TABLE IF NOT EXISTS remote_run (
        run_id     TEXT NOT NULL PRIMARY KEY,
        host_id    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];

/**
 * Apply the pending entries of the workspace chain in ONE transaction, so the
 * ledger never describes a half-upgraded schema. Returns the versions applied.
 */
export function runWorkspaceMigrations(
  db: Database.Database,
  chain: readonly WorkspaceMigration[] = WORKSPACE_MIGRATIONS,
): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => (r as { version: string }).version),
  );
  const pending = chain.filter((m) => !applied.has(m.version));
  if (pending.length === 0) return [];

  const record = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
  db.transaction(() => {
    for (const m of pending) {
      db.exec(m.sql);
      record.run(m.version);
    }
  })();
  return pending.map((m) => m.version);
}
