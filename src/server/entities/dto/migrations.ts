import type { SqlMigration } from '../../core/plugin-host/types.js';

/**
 * L1 (0.2.2): the schema of an entity table is owned by the module that
 * contributes the type, not by the host migration chain. `CREATE TABLE dto`
 * therefore lives here and is absent from `000_baseline.sql`.
 *
 * The shape is the post-`035_m29_slug_identity` / post-`015_dto_examples` one,
 * reproduced as a single statement — the historical chain reached it through
 * `002 → 015 → 035`, and a fresh database has no reason to replay that path.
 *
 * `IF NOT EXISTS` is the adoption mechanism for databases created before this
 * release: the chain already built the table, this migration no-ops, and the
 * `plugin_schema_migrations` row records that the module now owns it. It is NOT
 * a collision guard — that is `assertNoBaselineCollision` in plugin-migrate.ts,
 * which fails loudly instead of silently binding to a foreign schema.
 */
export const dtoMigrations: SqlMigration[] = [
  {
    version: 1,
    name: 'create_dto',
    up: `
      CREATE TABLE IF NOT EXISTS dto (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        fields TEXT NOT NULL DEFAULT '[]',
        examples TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];
