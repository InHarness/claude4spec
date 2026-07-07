import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { EndpointService } from './service.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import { DomainError } from '../../services/tags.js';
import type { EndpointDtoRelation } from '../../../shared/entities.js';

/**
 * M13: CRUD (create/get/update/delete/list) moved to the generic `entity-tools`
 * server — this custom server carries ONLY endpoint's non-CRUD relation tools.
 */
export interface EndpointToolsDeps {
  endpointService: EndpointService;
  ws: WsEmitter;
}

export function createEndpointToolsServer(deps: EndpointToolsDeps): McpServerInstance {
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

  const linkDto = mcpTool(
    'link_dto',
    'Link a DTO to an endpoint as request body, response, or error response. Optional HTTP status code for response/error. Idempotent.',
    {
      endpointSlug: z.string(),
      dtoSlug: z.string(),
      relation: z.enum(['request', 'response', 'error']),
      statusCode: z.number().optional(),
    },
    async (args) => {
      try {
        deps.endpointService.linkDto(
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

  const unlinkDto = mcpTool(
    'unlink_dto',
    'Remove a DTO link from an endpoint. Omit statusCode to remove all links (endpoint, dto, relation).',
    {
      endpointSlug: z.string(),
      dtoSlug: z.string(),
      relation: z.enum(['request', 'response', 'error']),
      statusCode: z.number().optional(),
    },
    async (args) => {
      try {
        deps.endpointService.unlinkDto(
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
    tools: [linkDto, unlinkDto],
  });
}
