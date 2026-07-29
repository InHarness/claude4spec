import type { SqlMigration } from '../../core/plugin-host/types.js';

/**
 * L1 (0.2.2): entity DDL is owned by the contributing module. See the docblock
 * on `dtoMigrations` for the adoption rules that apply to all of these.
 *
 * The `endpoint_dto` junction ships HERE rather than with `dto` because
 * `endpoint` is the module that declares `dependsOn: ['dto']` — the side that
 * knows about the relationship owns the table that encodes it. That also keeps
 * both of the junction's foreign keys inside one module's migration set.
 *
 * It is a separate version rather than more SQL in v1 so that the forward
 * reference to `dto(slug)` is isolated: `mountBackend` migrates every module
 * before it mounts any, so `dto` exists by the time this runs.
 */
export const endpointMigrations: SqlMigration[] = [
  {
    version: 1,
    name: 'create_endpoint',
    up: `
      CREATE TABLE IF NOT EXISTS endpoint (
        slug TEXT PRIMARY KEY,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 2,
    name: 'create_endpoint_dto',
    up: `
      CREATE TABLE IF NOT EXISTS endpoint_dto (
        endpoint_slug TEXT NOT NULL REFERENCES endpoint(slug) ON DELETE CASCADE ON UPDATE CASCADE,
        dto_slug      TEXT NOT NULL REFERENCES dto(slug)      ON DELETE CASCADE ON UPDATE CASCADE,
        relation TEXT NOT NULL,
        status_code INTEGER,
        UNIQUE(endpoint_slug, dto_slug, relation, status_code)
      );
      CREATE INDEX IF NOT EXISTS idx_endpoint_dto_endpoint ON endpoint_dto(endpoint_slug);
      CREATE INDEX IF NOT EXISTS idx_endpoint_dto_dto      ON endpoint_dto(dto_slug);
    `,
  },
];
