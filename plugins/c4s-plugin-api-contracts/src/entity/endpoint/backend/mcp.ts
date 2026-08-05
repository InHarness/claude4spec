// 0.1.133: build the custom MCP server through the C4S facade barrel
// (`@c4s/plugin-runtime`), never the vendor `@inharness-ai/agent-adapters` directly.
import { createMcpServer, mcpTool, type McpServerFactory } from '@c4s/plugin-runtime';
import { z } from 'zod';
import type { WsEmitterLike as WsEmitter } from '../../../host-kit/host-types.js';
import { DomainError } from '../../../host-kit/errors.js';
import type { EndpointDtoRelation } from '../../../types.js';
import { linkDto, unlinkDto, type LinkDtoDeps } from './link-dto.js';

/**
 * M13: CRUD (create/get/update/delete/list) moved to the generic `entity-tools`
 * server — this custom server carries ONLY endpoint's non-CRUD relation tools.
 *
 * 2.0.0 tier K: they no longer take an `EndpointService`. Both are sugar over
 * the `linkedDtos` collection, shared verbatim with the two REST routes, so the
 * tool and the route cannot disagree about what linking means.
 */
export interface EndpointToolsDeps {
  links: LinkDtoDeps;
  ws: WsEmitter;
}

export function createEndpointToolsServer(deps: EndpointToolsDeps): McpServerFactory {
  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  });
  const fail = (err: unknown) => {
    const code = err instanceof DomainError ? err.code : 'INTERNAL';
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: message, code }) }],
      isError: true,
    };
  };

  const linkDtoTool = mcpTool(
    'link_dto',
    'Link a DTO to an endpoint as request body, response, or error response. Optional HTTP status code for response/error. Idempotent.',
    {
      endpointSlug: z.string(),
      dtoSlug: z.string(),
      relation: z.enum(['request', 'response', 'error']),
      statusCode: z.number().optional(),
    },
    async (raw) => {
      const args = raw as Record<string, unknown>;
      try {
        await linkDto(
          deps.links,
          String(args.endpointSlug),
          String(args.dtoSlug),
          args.relation as EndpointDtoRelation,
          (args.statusCode as number | undefined) ?? null,
        );
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'endpoint', slug: String(args.endpointSlug) });
        return ok({ linked: true });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const unlinkDtoTool = mcpTool(
    'unlink_dto',
    'Remove a DTO link from an endpoint. Omit statusCode to remove all links (endpoint, dto, relation).',
    {
      endpointSlug: z.string(),
      dtoSlug: z.string(),
      relation: z.enum(['request', 'response', 'error']),
      statusCode: z.number().optional(),
    },
    async (raw) => {
      const args = raw as Record<string, unknown>;
      try {
        await unlinkDto(
          deps.links,
          String(args.endpointSlug),
          String(args.dtoSlug),
          args.relation as EndpointDtoRelation,
          (args.statusCode as number | undefined) ?? null,
        );
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'endpoint', slug: String(args.endpointSlug) });
        return ok({ unlinked: true });
      } catch (err) {
        return fail(err);
      }
    },
  );

  return createMcpServer({
    name: 'endpoint-tools',
    tools: [linkDtoTool, unlinkDtoTool],
  });
}
