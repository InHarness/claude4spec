import type { SqlMigration } from '../../core/plugin-host/types.js';

/**
 * L1 (0.2.2): entity DDL is owned by the contributing module. See the docblock
 * on `dtoMigrations` for the adoption rules, and on `designSystemMigrations`
 * for why this type moved even though the brief did not name it.
 */
export const diagramMigrations: SqlMigration[] = [
  {
    version: 1,
    name: 'create_diagram',
    up: `
      CREATE TABLE IF NOT EXISTS diagram (
        slug       TEXT NOT NULL PRIMARY KEY,
        format     TEXT NOT NULL DEFAULT 'mermaid',
        source     TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];
