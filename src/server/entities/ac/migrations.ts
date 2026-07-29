import type { SqlMigration } from '../../core/plugin-host/types.js';

/**
 * L1 (0.2.2): entity DDL is owned by the contributing module. See the docblock
 * on `dtoMigrations` for the adoption rules that apply to all of these.
 */
export const acMigrations: SqlMigration[] = [
  {
    version: 1,
    name: 'create_ac',
    up: `
      CREATE TABLE IF NOT EXISTS ac (
        slug TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'requirement',
        status TEXT NOT NULL DEFAULT 'active',
        verifies TEXT NOT NULL DEFAULT '[]',
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ac_status ON ac(status);
      CREATE INDEX IF NOT EXISTS idx_ac_kind   ON ac(kind);
    `,
  },
];
