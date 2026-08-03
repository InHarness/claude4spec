import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import { acSlug } from '../../services/slug.js';
import type { EntitySerializer } from '../../serialization/types.js';
import { acSerializer } from './serializer.js';
import { acSystemPrompt } from './system-prompt.js';
import { acsRouter } from './routes.js';
import { AcService } from './service.js';
import { createAcToolsServer } from './mcp-server.js';
import { acCreateSchema, acUpdateSchema } from './crud-schemas.js';
import { acMigrations } from './migrations.js';

export const acBackendModule: BackendModule = {
  type: 'ac',
  table: 'ac',
  label: 'Acceptance Criterion',
  labelPlural: 'Acceptance Criteria',
  displayOrder: 50,
  pathPrefix: '/acs',
  slugFrom: (data) => acSlug((data as { text?: string }).text ?? ''),
  serializer: acSerializer as EntitySerializer<unknown>,
  systemPrompt: acSystemPrompt,
  // M13: declarative backend — the host synthesizes an equivalent `mount` (see
  // manifest-adapter.ts#synthesizeMount): construct the service once, register
  // it for DI + entity-tools, mount the REST router, mount the custom MCP
  // server for ac's semantic-audit tool.
  backend: {
    migrations: acMigrations,
    /**
     * `ac.verifies[]` holds `{type, slug}` soft references — JSON, no FK — so a
     * rename of ANY entity type has to be followed by hand: repoint the refs in
     * the index, then re-persist each affected ac file.
     *
     * Formerly a branch in the host's ReferencesService, guarded by a hardcoded
     * list of "raw entity types". Dropping that guard is deliberate and strictly
     * more correct: a plugin-contributed type can be the target of a `verifies`
     * ref, and the old guard silently left those stale.
     */
    onEntityRenamed: ({ type, oldSlug, newSlug }, ctx) => {
      const candidates = ctx.db
        .prepare('SELECT slug, verifies FROM ac WHERE verifies LIKE ?')
        .all(`%${oldSlug}%`) as Array<{ slug: string; verifies: string }>;
      const update = ctx.db.prepare('UPDATE ac SET verifies = ? WHERE slug = ?');
      for (const ac of candidates) {
        let parsed: Array<{ type?: string; slug?: string }>;
        try {
          parsed = JSON.parse(ac.verifies) as Array<{ type?: string; slug?: string }>;
          if (!Array.isArray(parsed)) continue;
        } catch {
          continue;
        }
        let changed = false;
        for (const ref of parsed) {
          if (ref && ref.type === type && ref.slug === oldSlug) {
            ref.slug = newSlug;
            changed = true;
          }
        }
        if (!changed) continue;
        update.run(JSON.stringify(parsed), ac.slug);
        try {
          ctx.entityStore.persist('ac', ac.slug);
        } catch {
          /* skip */
        }
      }
    },
    service: (ctx) => new AcService(ctx.db, ctx.tagsService, ctx.versionService, ctx.host, ctx.entityStore),
    crud: {
      createSchema: acCreateSchema,
      updateSchema: acUpdateSchema,
    },
    routes: {
      router: (service, ctx) => acsRouter(service as AcService, ctx.referencesService),
    },
    mcpServer: (service, ctx) =>
      createAcToolsServer({
        acService: service as AcService,
        db: ctx.db,
        cwd: ctx.cwd,
        roots: ctx.roots,
        host: ctx.host,
      }),
  },
};

/** M31: self-registration side effect replaced by an explicit hook — called once per process by registerAllPlugins(registry). */
export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(acBackendModule);
}
