import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeWorkspaceDbs, openWorkspaceDb, workspaceDbPath, WorkspaceDbUnavailableError } from './workspace-db.js';
import { runWorkspaceMigrations, WORKSPACE_MIGRATIONS } from './workspace-migrations.js';
import { openDb } from './index.js';
import { WorkspaceRegistry } from '../workspace/registry.js';
import { homeLocalDir, homeRunsDir } from '../workspace/home-workspace.js';
import { listSlotIds } from '../workspace/slot-marker.js';
import { remoteRunRegistry } from '../runs/remote-run-registry.js';

/**
 * 2.1.64 — the workspace database (M41 `zyj684t8`, `8eat4b2c`, `3usphti7`,
 * L10 `ay8og61p`; M31 `t97gncju`, `vzkw903j`) and its first table, M55's
 * `remote_run` (`gsw1z1h3`).
 *
 * Every test runs over a throwaway home — nothing touches a real repo.
 */
describe('M41 openWorkspaceDb — the workspace-scope database', () => {
  let tmp: string;
  let home: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-ws-db-'));
    home = path.join(tmp, 'repo');
    fs.mkdirSync(home, { recursive: true });
  });
  afterEach(() => {
    closeWorkspaceDbs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const ws = (): { name: string; home: string } => ({ name: 'team', home });

  /** The workspace view a start builds before listen (registry entry + workspace.json). */
  const openHomeView = (): void => {
    const registryHome = path.join(tmp, 'registry');
    fs.mkdirSync(registryHome, { recursive: true });
    fs.writeFileSync(
      path.join(registryHome, 'workspaces.json'),
      JSON.stringify({ $schemaVersion: 3, workspaces: [{ name: 'team', mode: 'prod', defaultPort: 4601, home }] }),
    );
    fs.mkdirSync(path.join(home, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude4spec', 'workspace.json'), JSON.stringify({ projects: [], plugins: [] }));
    new WorkspaceRegistry(registryHome).openView('team');
  };

  it('[section:zyj684t8] a workspace with a home gets workspace.sqlite in <home>/.claude4spec/local/, next to the slot directories', () => {
    expect(fs.existsSync(workspaceDbPath(home))).toBe(false);
    const db = openWorkspaceDb(ws());
    expect(workspaceDbPath(home)).toBe(path.join(home, '.claude4spec', 'local', 'workspace.sqlite'));
    expect(fs.existsSync(workspaceDbPath(home))).toBe(true);
    expect(db.name).toBe(path.resolve(workspaceDbPath(home)));
  });

  it('[section:zyj684t8] a registry workspace has no workspace database — the call throws, it never yields an empty database', () => {
    expect(() => openWorkspaceDb({ name: 'solo' })).toThrow(WorkspaceDbUnavailableError);
    try {
      openWorkspaceDb({ name: 'solo', home: undefined });
    } catch (err) {
      expect((err as WorkspaceDbUnavailableError).code).toBe('WORKSPACE_DB_UNAVAILABLE');
    }
  });

  it('[section:zyj684t8] lazy and idempotent per workspace: nothing exists before the first request, every later request gets the same handle', () => {
    // Opening the workspace view / its slots does not create the database.
    openHomeView();
    expect(fs.existsSync(workspaceDbPath(home))).toBe(false);

    const a = openWorkspaceDb(ws());
    const b = openWorkspaceDb({ ...ws() });
    expect(b).toBe(a);
    expect(a.open).toBe(true);
  });

  it('[section:zyj684t8] the same pragmas as openDb: WAL and foreign_keys = ON', () => {
    const db = openWorkspaceDb(ws());
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('[section:ay8og61p] the handle lives until the process closes — released explicitly by closeWorkspaceDbs, installed as the process exit hook', () => {
    const db = openWorkspaceDb(ws());
    expect(process.listeners('exit')).toContain(closeWorkspaceDbs);
    closeWorkspaceDbs();
    expect(db.open).toBe(false);
    // A later request after the explicit release opens the file afresh.
    expect(openWorkspaceDb(ws()).open).toBe(true);
  });

  it('[section:8eat4b2c] the workspace DB has its own schema_migrations and its own chain; the two chains never touch each other\'s file', () => {
    const wdb = openWorkspaceDb(ws());
    const versions = (wdb.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
      version: string;
    }>).map((r) => r.version);
    expect(versions).toEqual(WORKSPACE_MIGRATIONS.map((m) => m.version));

    const tables = (wdb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>).map((r) => r.name);
    // Only workspace-scope authored tables — no slot host tables, no entity tables.
    expect(tables).toEqual(['remote_run', 'schema_migrations']);

    // A project slot in the same local/ directory runs the host chain and gets no remote_run.
    const slot = openDb(path.join(homeLocalDir(home), 'web'));
    try {
      const slotTables = (slot.handle
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>).map((r) => r.name);
      expect(slotTables).not.toContain('remote_run');
      const slotVersions = (slot.handle.prepare('SELECT version FROM schema_migrations').all() as Array<{
        version: string;
      }>).map((r) => r.version);
      for (const m of WORKSPACE_MIGRATIONS) expect(slotVersions).not.toContain(m.version);
    } finally {
      slot.close();
    }
    // The workspace DB is unchanged by the slot chain.
    expect(
      (wdb.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n,
    ).toBe(WORKSPACE_MIGRATIONS.length);
  });

  it('[section:8eat4b2c] the workspace chain is idempotent and additive: a rerun applies nothing, a new entry applies only itself', () => {
    const db = new Database(':memory:');
    try {
      expect(runWorkspaceMigrations(db)).toEqual(WORKSPACE_MIGRATIONS.map((m) => m.version));
      expect(runWorkspaceMigrations(db)).toEqual([]);
      const extended = [...WORKSPACE_MIGRATIONS, { version: '999_probe', sql: 'CREATE TABLE IF NOT EXISTS probe (x TEXT);' }];
      expect(runWorkspaceMigrations(db, extended)).toEqual(['999_probe']);
    } finally {
      db.close();
    }
  });

  it('[section:vzkw903j] workspace.sqlite (and its WAL sidecars) is never taken for a slot of the local/ directory', () => {
    openWorkspaceDb(ws());
    fs.mkdirSync(path.join(homeLocalDir(home), 'web'), { recursive: true });
    expect(listSlotIds(homeLocalDir(home))).toEqual(['web']);
  });

  it('[section:t97gncju] runs/ is the committed place for Run records: inside <home>/.claude4spec/, not git-ignored, and never written by the server', () => {
    openHomeView();
    openWorkspaceDb(ws());

    expect(homeRunsDir(home)).toBe(path.join(home, '.claude4spec', 'runs'));
    expect(fs.existsSync(homeRunsDir(home))).toBe(false);
    const ignored = fs
      .readFileSync(path.join(home, '.claude4spec', '.gitignore'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    expect(ignored).toEqual(['local/']);
  });
});

describe('M55 remote_run — the Run registry table (database-table remote-run)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-remote-run-'));
  });
  afterEach(() => {
    closeWorkspaceDbs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('[entity:remote-run] PRAGMA table_info matches the entity: run_id TEXT NOT NULL PK, host_id TEXT NOT NULL, parent_run_id TEXT NULL, created_at TEXT NOT NULL DEFAULT datetime(\'now\')', () => {
    const db = openWorkspaceDb({ name: 'team', home: tmp });
    const cols = db.pragma('table_info(remote_run)') as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    expect(cols.map((c) => ({ name: c.name, type: c.type, notnull: c.notnull, dflt: c.dflt_value, pk: c.pk }))).toEqual([
      { name: 'run_id', type: 'TEXT', notnull: 1, dflt: null, pk: 1 },
      { name: 'host_id', type: 'TEXT', notnull: 1, dflt: null, pk: 0 },
      { name: 'created_at', type: 'TEXT', notnull: 1, dflt: "datetime('now')", pk: 0 },
      // 2.1.68: added by `ALTER TABLE ... ADD COLUMN`, so it follows created_at physically; nullable, no default.
      { name: 'parent_run_id', type: 'TEXT', notnull: 0, dflt: null, pk: 0 },
      // 2.1.73: the thread pair and the plan pair, nullable TEXT without a default, after parent_run_id.
      { name: 'thread_id', type: 'TEXT', notnull: 0, dflt: null, pk: 0 },
      { name: 'thread_project_id', type: 'TEXT', notnull: 0, dflt: null, pk: 0 },
      { name: 'project_id', type: 'TEXT', notnull: 0, dflt: null, pk: 0 },
      { name: 'plan_path', type: 'TEXT', notnull: 0, dflt: null, pk: 0 },
    ]);
  });

  it('[entity:remote-run] a workspace DB created before 2.1.68 (001 only) gets parent_run_id from 002, existing rows keep NULL, and the ledger records both versions', () => {
    const file = path.join(tmp, 'old.sqlite');
    const db = new Database(file);
    try {
      runWorkspaceMigrations(db, WORKSPACE_MIGRATIONS.slice(0, 1));
      db.prepare('INSERT INTO remote_run (run_id, host_id) VALUES (?, ?)').run('01jold00000000000000000000', 'host-a');
      expect(runWorkspaceMigrations(db, WORKSPACE_MIGRATIONS.slice(0, 2))).toEqual(['002_remote_run_parent_run_id']);
      expect(runWorkspaceMigrations(db, WORKSPACE_MIGRATIONS.slice(0, 2))).toEqual([]);
      const row = db.prepare('SELECT run_id, host_id, parent_run_id FROM remote_run').get();
      expect(row).toEqual({ run_id: '01jold00000000000000000000', host_id: 'host-a', parent_run_id: null });
      const versions = (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: string }>).map((r) => r.version);
      expect(versions).toEqual(['001_remote_run', '002_remote_run_parent_run_id']);
    } finally {
      db.close();
    }
  });

  it('[entity:remote-run] 2.1.73: a workspace DB from before (001–002) gets the four thread/plan columns from 003 — an existing row has NULL in all four, and the ledger records 003 once', () => {
    const file = path.join(tmp, 'pre-273.sqlite');
    const db = new Database(file);
    try {
      runWorkspaceMigrations(db, WORKSPACE_MIGRATIONS.slice(0, 2));
      db.prepare('INSERT INTO remote_run (run_id, host_id, parent_run_id) VALUES (?, ?, ?)').run(
        '01jold00000000000000000000',
        'host-a',
        '01jparent00000000000000000',
      );
      expect(runWorkspaceMigrations(db)).toEqual(['003_remote_run_thread_plan']);
      expect(runWorkspaceMigrations(db)).toEqual([]);
      expect(db.prepare('SELECT * FROM remote_run').get()).toMatchObject({
        run_id: '01jold00000000000000000000',
        host_id: 'host-a',
        parent_run_id: '01jparent00000000000000000',
        thread_id: null,
        thread_project_id: null,
        project_id: null,
        plan_path: null,
      });
      const versions = (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: string }>).map((r) => r.version);
      expect(versions).toEqual(['001_remote_run', '002_remote_run_parent_run_id', '003_remote_run_thread_plan']);
      // The shipped entries are unchanged: 003 is appended at the end of the chain.
      expect(WORKSPACE_MIGRATIONS.map((m) => m.version)).toEqual(['001_remote_run', '002_remote_run_parent_run_id', '003_remote_run_thread_plan']);
    } finally {
      db.close();
    }
  });

  it('[entity:remote-run] 2.1.73: one INSERT writes the thread and plan columns; missing values and empty strings are NULL, and the thread pair is both-or-neither', () => {
    const db = openWorkspaceDb({ name: 'team', home: tmp });
    const registry = remoteRunRegistry(() => db);
    registry.insert({ runId: '01jfull000000000000000000a', hostId: 'host-a', threadId: 't1', threadProjectId: 'app', projectId: 'docs', planPath: 'p1.md' });
    registry.insert({ runId: '01jbare000000000000000000b', hostId: 'host-a', projectId: '', planPath: '' });
    registry.insert({ runId: '01jhalf000000000000000000c', hostId: 'host-a', threadId: 't1', threadProjectId: null });
    const sel = db.prepare('SELECT thread_id, thread_project_id, project_id, plan_path FROM remote_run WHERE run_id = ?');
    expect(sel.get('01jfull000000000000000000a')).toEqual({ thread_id: 't1', thread_project_id: 'app', project_id: 'docs', plan_path: 'p1.md' });
    expect(sel.get('01jbare000000000000000000b')).toEqual({ thread_id: null, thread_project_id: null, project_id: null, plan_path: null });
    expect(sel.get('01jhalf000000000000000000c')).toEqual({ thread_id: null, thread_project_id: null, project_id: null, plan_path: null });
  });

  it('[entity:remote-run] the registry writes and reads every column: run_id, host_id, parent_run_id (set for a continuation, NULL without a parent) and created_at by default', () => {
    const db = openWorkspaceDb({ name: 'team', home: tmp });
    const registry = remoteRunRegistry(() => db);
    registry.insert({ runId: '01jchild000000000000000000', hostId: 'host-a', parentRunId: '01jparent00000000000000000' });
    registry.insert({ runId: '01jplain000000000000000000', hostId: 'host-b' });
    const child = registry.get('01jchild000000000000000000')!;
    expect(child).toMatchObject({ runId: '01jchild000000000000000000', hostId: 'host-a', parentRunId: '01jparent00000000000000000' });
    expect(child.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(registry.get('01jplain000000000000000000')).toMatchObject({ hostId: 'host-b', parentRunId: null });
    expect(registry.hostOf('01jchild000000000000000000')).toBe('host-a');
    expect(db.prepare('SELECT parent_run_id FROM remote_run WHERE run_id = ?').get('01jchild000000000000000000')).toEqual({
      parent_run_id: '01jparent00000000000000000',
    });
    registry.delete('01jchild000000000000000000');
    expect(registry.get('01jchild000000000000000000')).toBeNull();
  });

  it('[entity:remote-run] PRAGMA index_list holds only the primary key — indexes: [] — and the table has no foreign key', () => {
    const db = openWorkspaceDb({ name: 'team', home: tmp });
    const indexes = db.pragma('index_list(remote_run)') as Array<{ name: string; origin: string; unique: number }>;
    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.origin).toBe('pk');
    expect(indexes[0]!.unique).toBe(1);
    expect(db.pragma('foreign_key_list(remote_run)')).toEqual([]);
  });

  it('[entity:remote-run] an INSERT gets created_at by default, a repeated run_id is refused, a DELETE removes the row', () => {
    const db = openWorkspaceDb({ name: 'team', home: tmp });
    db.prepare('INSERT INTO remote_run (run_id, host_id) VALUES (?, ?)').run('01jabcdefghjkmnpqrstvwxyz0', 'host-a');
    const row = db.prepare('SELECT * FROM remote_run').get() as { run_id: string; host_id: string; created_at: string };
    expect(row.host_id).toBe('host-a');
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(() =>
      db.prepare('INSERT INTO remote_run (run_id, host_id) VALUES (?, ?)').run('01jabcdefghjkmnpqrstvwxyz0', 'host-b'),
    ).toThrow(/UNIQUE|PRIMARY KEY/);
    expect(() => db.prepare('INSERT INTO remote_run (run_id) VALUES (?)').run('01jzzz')).toThrow(/NOT NULL/);
    db.prepare('DELETE FROM remote_run WHERE run_id = ?').run('01jabcdefghjkmnpqrstvwxyz0');
    expect((db.prepare('SELECT COUNT(*) AS n FROM remote_run').get() as { n: number }).n).toBe(0);
  });
});
