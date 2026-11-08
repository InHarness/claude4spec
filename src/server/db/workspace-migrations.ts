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
  {
    // 2.1.68 (M55 `gsw1z1h3`, database-table `remote-run`): `parent_run_id` —
    // the runId of the parent of a continuation Run; NULL for a Run without a
    // parent. Not a FK: the parent is sometimes known only from its record in
    // git. Additive (`ADD COLUMN`), so the column follows `created_at` in the
    // physical order; the ledger applies it exactly once.
    version: '002_remote_run_parent_run_id',
    sql: `
      ALTER TABLE remote_run ADD COLUMN parent_run_id TEXT;
    `,
  },
  {
    // 2.1.73 (M55 `gsw1z1h3`, database-table `remote-run`): the thread that
    // ordered the Run (`thread_id` + `thread_project_id`, a pair — the thread id
    // is unique only within its project's slot) and the plan it started with
    // (`project_id` + `plan_path`, relative to that project's plans directory;
    // NULL for a prompt input). Write-only in this release — nothing reads them.
    // No FK (`chat_thread` lives in the slot DB), no index, no default. Rows from
    // before this migration keep NULL in all four.
    version: '003_remote_run_thread_plan',
    sql: `
      ALTER TABLE remote_run ADD COLUMN thread_id TEXT;
      ALTER TABLE remote_run ADD COLUMN thread_project_id TEXT;
      ALTER TABLE remote_run ADD COLUMN project_id TEXT;
      ALTER TABLE remote_run ADD COLUMN plan_path TEXT;
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
