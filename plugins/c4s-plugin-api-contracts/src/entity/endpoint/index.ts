import type { EntityContribution, MountContext } from '@c4s/plugin-runtime';
import {
  ENDPOINT_DISPLAY_ORDER,
  ENDPOINT_PATH_PREFIX,
  ENDPOINT_TYPE,
} from '../../identity.js';
import { endpointSerializer } from './serializer.js';
import { endpointSystemPrompt } from './system-prompt.js';
import { endpointsRouter } from './backend/routes.js';
import { createEndpointToolsServer } from './backend/mcp.js';
import type { DtoLink, LinkDtoDeps } from './backend/link-dto.js';
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
  /**
   * 2.0.0 tier K (item 58) — no `service`. `EndpointService` is deleted; CRUD
   * comes from `data` above, and the two relation verbs are collection writes
   * (`./backend/link-dto.ts`) shared by the router and the MCP tools.
   *
   * The hand-written `onEntityRenamed` went in 2.0.0: a DTO rename cascades
   * through the junction's ON UPDATE CASCADE, and `ref: 'dto'` on
   * `linkedDtos[].dto` is what tells the host to re-persist the endpoint FILES
   * that still embed the old slug.
   */
  backend: {
    routes: { router: (_service: unknown, ctx: MountContext) => endpointsRouter(linkDeps(ctx)) },
    mcpServer: (_service: unknown, ctx: MountContext) =>
      createEndpointToolsServer({ links: linkDeps(ctx), ws: ctx.ws }),
  },
} as EntityContribution;

/**
 * Bind the collection-write helpers to this project's host handles.
 *
 * `update` hands the WHOLE `linkedDtos` array to the host's update verb, which
 * is what `collection: 'value'` means — the host diffs the junction rows, keeps
 * the FK, captures the version and re-persists the file. None of that is this
 * plugin's business any more.
 */
function linkDeps(ctx: MountContext): LinkDtoDeps {
  return {
    reader: ctx.reader,
    update: (slug: string, linkedDtos: DtoLink[]) =>
      void ctx.crud.update(ENDPOINT_TYPE, slug, { linkedDtos }, 'user'),
  };
}
