import type { EntityContribution, MountContext } from '@c4s/plugin-runtime';
import {
  ENDPOINT_DISPLAY_ORDER,
  ENDPOINT_PATH_PREFIX,
  ENDPOINT_TYPE,
} from '../../identity.js';
import { endpointSerializer } from './serializer.js';
import { endpointSystemPrompt } from './system-prompt.js';
import { endpointsRouter } from './backend/routes.js';
import { EndpointService } from './backend/services.js';
import { createEndpointToolsServer } from './backend/mcp.js';
import { endpointCreateSchema, endpointUpdateSchema } from './backend/crud-schemas.js';
import { endpointData, endpointSlugPattern } from './schema.js';

/**
 * The `endpoint` contribution — the side of the pair that owns the junction.
 */
export const endpointEntity: EntityContribution = {
  type: ENDPOINT_TYPE,
  data: endpointData,
  slugPattern: endpointSlugPattern,
  /**
   * 2 since 0.2.9: the generated snapshot spells the junction in DECLARED
   * field names (`linkedDtos`/`dto`/`statusCode`) where the hand-written one
   * spelled it in column names, and stops coercing an empty `summary` to null.
   * See `./upgrades.ts`.
   */
  payloadVersion: 2,
  label: 'Endpoint',
  labelPlural: 'Endpoints',
  displayOrder: ENDPOINT_DISPLAY_ORDER,
  pathPrefix: ENDPOINT_PATH_PREFIX,
  /**
   * Restore and index order is declared here, by the module that knows the
   * constraint. An endpoint links DTOs through the junction, so DTO rows must
   * exist first or the FK rejects the link. "DTO before Endpoint" is the RESULT
   * of this line; the host's topological sort only consumes it.
   */
  dependsOn: ['dto'],
  serializer: endpointSerializer,
  systemPrompt: endpointSystemPrompt,
  backend: {
    // 2.0.0: the hand-written `onEntityRenamed` is gone. A DTO rename still
    // cascades through the junction's ON UPDATE CASCADE and the endpoint FILES
    // still embed the old slug — but `ref: 'dto'` on `linkedDtos[].dto` is what
    // tells the host to collect those endpoints and re-persist them.
    service: (ctx: MountContext) => new EndpointService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore),
    crud: { createSchema: endpointCreateSchema, updateSchema: endpointUpdateSchema },
    routes: {
      router: (service: unknown, ctx: MountContext) => endpointsRouter(service as EndpointService, ctx.referencesService),
    },
    mcpServer: (service: unknown, ctx: MountContext) =>
      createEndpointToolsServer({ endpointService: service as EndpointService, ws: ctx.ws }),
  },
} as EntityContribution;
