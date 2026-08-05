import type { EntityContribution, MountContext } from '@c4s/plugin-runtime';
import { DTO_DISPLAY_ORDER, DTO_PATH_PREFIX, DTO_TYPE } from '../../identity.js';
import { dtoSerializer } from './serializer.js';
import { dtoSystemPrompt } from './system-prompt.js';
import { DtoService } from './backend/services.js';
import { dtoData, dtoSlugPattern } from './schema.js';

/**
 * The `dto` contribution. Declarative backend throughout — the host synthesizes
 * the equivalent `mount`: build the service once, register it for DI and
 * `entity-tools`. 2.0.0 tier K — no `routes` slot: the host's generated
 * `/api/dtos` router serves every CRUD verb, and `dto` had nothing else. No
 * custom MCP server either; its relation tools belong to `endpoint`.
 */
export const dtoEntity: EntityContribution = {
  type: DTO_TYPE,
  data: dtoData,
  slugPattern: dtoSlugPattern,
  payloadVersion: 1,
  label: 'DTO',
  labelPlural: 'DTOs',
  displayOrder: DTO_DISPLAY_ORDER,
  pathPrefix: DTO_PATH_PREFIX,
  serializer: dtoSerializer,
  systemPrompt: dtoSystemPrompt,
  backend: {
    service: (ctx: MountContext) => new DtoService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore),
  },
} as EntityContribution;
