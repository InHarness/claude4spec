import type { EntityContribution, MountContext } from '@c4s/plugin-runtime';
import { DTO_DISPLAY_ORDER, DTO_PATH_PREFIX, DTO_TABLE, DTO_TYPE, dtoSlug } from '../../identity.js';
import { dtoSerializer } from './serializer.js';
import { dtoSystemPrompt } from './system-prompt.js';
import { dtosRouter } from './backend/routes.js';
import { DtoService } from './backend/services.js';
import { dtoCreateSchema, dtoUpdateSchema } from './backend/crud-schemas.js';
import { dtoMigrations } from './backend/migrations.js';

/**
 * The `dto` contribution. Declarative backend throughout — the host synthesizes
 * the equivalent `mount`: build the service once, register it for DI and
 * `entity-tools`, mount the REST router. No custom MCP server; `dto` has no
 * non-CRUD tools of its own (the relation tools belong to `endpoint`).
 */
export const dtoEntity: EntityContribution = {
  type: DTO_TYPE,
  table: DTO_TABLE,
  label: 'DTO',
  labelPlural: 'DTOs',
  displayOrder: DTO_DISPLAY_ORDER,
  pathPrefix: DTO_PATH_PREFIX,
  slugFrom: (data: unknown) => dtoSlug((data as { name: string }).name),
  serializer: dtoSerializer,
  systemPrompt: dtoSystemPrompt,
  backend: {
    migrations: dtoMigrations,
    service: (ctx: MountContext) => new DtoService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore),
    crud: { createSchema: dtoCreateSchema, updateSchema: dtoUpdateSchema },
    routes: { router: (service: unknown, ctx: MountContext) => dtosRouter(service as DtoService, ctx.referencesService) },
  },
} as EntityContribution;
