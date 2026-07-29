import type { SqlMigration } from '../../core/plugin-host/types.js';

/**
 * L1 (0.2.2): entity DDL is owned by the contributing module. See the docblock
 * on `dtoMigrations` for the adoption rules that apply to all of these.
 *
 * `design_system_slug` is deliberately the LAST column: the historical chain
 * appended it via `ALTER TABLE` in `037`, and the baseline-identity gate
 * compares `PRAGMA table_info` positionally.
 */
export const uiViewMigrations: SqlMigration[] = [
  {
    version: 1,
    name: 'create_ui_view',
    up: `
      CREATE TABLE IF NOT EXISTS ui_view (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT,
        description TEXT,
        params TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        design_system_slug TEXT
      );
    `,
  },
];
