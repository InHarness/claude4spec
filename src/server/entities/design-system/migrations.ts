import type { SqlMigration } from '../../core/plugin-host/types.js';

/**
 * L1 (0.2.2): entity DDL is owned by the contributing module. See the docblock
 * on `dtoMigrations` for the adoption rules that apply to all of these.
 *
 * The brief's item 3 names only endpoint/dto/endpoint_dto/ui_view/ac, but
 * `design_system` and `diagram` are core modules of exactly the same kind.
 * Leaving them in the baseline would make the rule "entity DDL belongs to the
 * module" carry two unexplained exceptions, and would make the schema-ownership
 * collision check inconsistent — a third-party module contributing `diagram`
 * would be rejected while one contributing `ac` would not.
 */
export const designSystemMigrations: SqlMigration[] = [
  {
    version: 1,
    name: 'create_design_system',
    up: `
      CREATE TABLE IF NOT EXISTS design_system (
        slug        TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        groups      TEXT NOT NULL DEFAULT '[]',
        modes       TEXT NOT NULL DEFAULT '[]',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];
