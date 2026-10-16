/**
 * 2.1.26 — `endpoint-tools · link_dto` and `endpoint-tools · unlink_dto` as their
 * re-rendered `mcp-tool` records declare them: name, description, parameters
 * (no parameter descriptions), no declared hint, and the behaviour each record's
 * `logic` states. The records are copied here, not read from the code, so the
 * registered tools are held against the specification.
 */

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createEndpointToolsServer } from '../../src/entity/endpoint/backend/mcp.js';
import type { DtoLink, LinkDtoDeps } from '../../src/entity/endpoint/backend/link-dto.js';

const RECORD_PARAMS = [
  { name: 'dtoSlug', type: 'string', required: true },
  { name: 'endpointSlug', type: 'string', required: true },
  { name: 'relation', type: 'enum(request, response, error)', required: true },
  { name: 'statusCode', type: 'number', required: false },
];

const RECORDS = {
  link_dto: {
    description:
      'Link a DTO to an endpoint as request body, response, or error response. Optional HTTP status code for response/error. Idempotent.',
  },
  unlink_dto: {
    description: 'Remove a DTO link from an endpoint. Omit statusCode to remove all links (endpoint, dto, relation).',
  },
} as const;

interface Tool {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: object;
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
}

type Json = { type?: string; enum?: unknown[]; description?: string; properties?: Record<string, Json>; required?: string[] };

function declaredParams(tool: Tool) {
  const json = z.toJSONSchema(z.object(tool.inputSchema as z.ZodRawShape), { io: 'input' }) as Json;
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {})
    .map(([name, s]) => ({
      name,
      type: s.enum ? `enum(${s.enum.join(', ')})` : (s.type ?? '?'),
      required: required.has(name),
      ...(s.description !== undefined ? { description: s.description } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One endpoint `get-users` (with the given links) and the DTOs named; `update` records the written collection. */
function rig(opts: { links?: DtoLink[]; dtos?: string[]; updateThrows?: Error } = {}) {
  let stored: DtoLink[] = opts.links ?? [];
  const dtos = new Set(opts.dtos ?? ['user-dto', 'error-dto']);
  const update = vi.fn(async (_slug: string, linkedDtos: DtoLink[]) => {
    if (opts.updateThrows) throw opts.updateThrows;
    stored = linkedDtos;
  });
  const dtoTouched = vi.fn();
  const links: LinkDtoDeps = {
    reader: {
      getEntity: (type, slug) => (type === 'endpoint' ? slug === 'get-users' : dtos.has(slug)) || null,
      readCollection: () => stored,
    },
    update,
    dtoTouched,
  };
  const server = createEndpointToolsServer({ links }) as unknown as { tools: readonly Tool[] };
  const tool = (name: string) => server.tools.find((t) => t.name === name)!;
  return { tool, update, dtoTouched, stored: () => stored, names: server.tools.map((t) => t.name) };
}

const body = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0]!.text) as Record<string, unknown>;

describe('[entity:endpoint-tools-link-dto] endpoint-tools · link_dto', () => {
  it('[entity:endpoint-tools-link-dto] is registered with the record\'s name, description, params and no declared hints', () => {
    const { tool, names } = rig();
    expect(names).toContain('link_dto');
    const t = tool('link_dto');
    expect(t.description).toBe(RECORDS.link_dto.description);
    expect(declaredParams(t)).toEqual(RECORD_PARAMS);
    expect(t.annotations ?? {}).toEqual({});
  });

  it('[entity:endpoint-tools-link-dto] a relation outside request/response/error, or statusCode on request, is VALIDATION; nothing is written', async () => {
    const { tool, update } = rig();
    const bogus = await tool('link_dto').handler({ endpointSlug: 'get-users', dtoSlug: 'user-dto', relation: 'bogus' });
    expect(bogus.isError).toBe(true);
    expect(body(bogus).code).toBe('VALIDATION');
    const req = await tool('link_dto').handler({ endpointSlug: 'get-users', dtoSlug: 'user-dto', relation: 'request', statusCode: 200 });
    expect(req.isError).toBe(true);
    expect(body(req).code).toBe('VALIDATION');
    expect(update).not.toHaveBeenCalled();
  });

  it('[entity:endpoint-tools-link-dto] an unknown DTO or endpoint is NOT_FOUND; another error is INTERNAL', async () => {
    const { tool } = rig();
    const dto = await tool('link_dto').handler({ endpointSlug: 'get-users', dtoSlug: 'ghost-dto', relation: 'response', statusCode: 200 });
    expect(body(dto).code).toBe('NOT_FOUND');
    const endpoint = await tool('link_dto').handler({ endpointSlug: 'ghost', dtoSlug: 'user-dto', relation: 'response', statusCode: 200 });
    expect(body(endpoint).code).toBe('NOT_FOUND');
    const broken = rig({ updateThrows: new Error('disk full') });
    const internal = await broken.tool('link_dto').handler({ endpointSlug: 'get-users', dtoSlug: 'user-dto', relation: 'response', statusCode: 200 });
    expect(internal.isError).toBe(true);
    expect(body(internal)).toEqual({ error: 'disk full', code: 'INTERNAL' });
  });

  it('[entity:endpoint-tools-link-dto] appends the entry to linkedDtos and announces the DTO; returns { linked: true }', async () => {
    const { tool, update, dtoTouched, stored } = rig({ links: [{ dto: 'error-dto', relation: 'error', statusCode: 404 }] });
    const res = await tool('link_dto').handler({ endpointSlug: 'get-users', dtoSlug: 'user-dto', relation: 'response', statusCode: 200 });
    expect(res.isError).toBeFalsy();
    expect(body(res)).toEqual({ linked: true });
    expect(update).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual([
      { dto: 'error-dto', relation: 'error', statusCode: 404 },
      { dto: 'user-dto', relation: 'response', statusCode: 200 },
    ]);
    expect(dtoTouched).toHaveBeenCalledWith('user-dto');
  });

  it('[entity:endpoint-tools-link-dto] an identical binding already present is { linked: true } with no write — idempotent', async () => {
    const { tool, update, dtoTouched } = rig({ links: [{ dto: 'user-dto', relation: 'response', statusCode: 200 }] });
    const res = await tool('link_dto').handler({ endpointSlug: 'get-users', dtoSlug: 'user-dto', relation: 'response', statusCode: 200 });
    expect(body(res)).toEqual({ linked: true });
    expect(update).not.toHaveBeenCalled();
    expect(dtoTouched).not.toHaveBeenCalled();
  });

  it('[entity:endpoint-tools-link-dto] a status that is not an integer is treated as no status — also on request, where it is not a refusal', async () => {
    const response = rig();
    await response.tool('link_dto').handler({ endpointSlug: 'get-users', dtoSlug: 'user-dto', relation: 'response', statusCode: 200.5 });
    expect(response.stored()).toEqual([{ dto: 'user-dto', relation: 'response', statusCode: null }]);
    const request = rig();
    const res = await request.tool('link_dto').handler({ endpointSlug: 'get-users', dtoSlug: 'user-dto', relation: 'request', statusCode: 1.5 });
    expect(body(res)).toEqual({ linked: true });
    expect(request.stored()).toEqual([{ dto: 'user-dto', relation: 'request', statusCode: null }]);
  });
});

describe('[entity:endpoint-tools-unlink-dto] endpoint-tools · unlink_dto', () => {
  const twoErrors: DtoLink[] = [
    { dto: 'error-dto', relation: 'error', statusCode: 404 },
    { dto: 'error-dto', relation: 'error', statusCode: 500 },
    { dto: 'user-dto', relation: 'response', statusCode: 200 },
  ];

  it('[entity:endpoint-tools-unlink-dto] is registered with the record\'s name, description, params and no declared hints', () => {
    const { tool, names } = rig();
    expect(names).toContain('unlink_dto');
    const t = tool('unlink_dto');
    expect(t.description).toBe(RECORDS.unlink_dto.description);
    expect(declaredParams(t)).toEqual(RECORD_PARAMS);
    expect(t.annotations ?? {}).toEqual({});
  });

  it('[entity:endpoint-tools-unlink-dto] an unknown endpoint is NOT_FOUND; another error is INTERNAL', async () => {
    const { tool } = rig({ links: twoErrors });
    const res = await tool('unlink_dto').handler({ endpointSlug: 'ghost', dtoSlug: 'error-dto', relation: 'error' });
    expect(res.isError).toBe(true);
    expect(body(res).code).toBe('NOT_FOUND');
    const broken = rig({ links: twoErrors, updateThrows: new Error('disk full') });
    const internal = await broken.tool('unlink_dto').handler({ endpointSlug: 'get-users', dtoSlug: 'error-dto', relation: 'error' });
    expect(body(internal)).toEqual({ error: 'disk full', code: 'INTERNAL' });
  });

  it('[entity:endpoint-tools-unlink-dto] with statusCode only the entry of that status goes; without it every entry of that DTO and relation; then the DTO is announced', async () => {
    const one = rig({ links: twoErrors });
    const res = await one.tool('unlink_dto').handler({ endpointSlug: 'get-users', dtoSlug: 'error-dto', relation: 'error', statusCode: 404 });
    expect(body(res)).toEqual({ unlinked: true });
    expect(one.stored()).toEqual([twoErrors[1], twoErrors[2]]);
    expect(one.dtoTouched).toHaveBeenCalledWith('error-dto');

    const all = rig({ links: twoErrors });
    await all.tool('unlink_dto').handler({ endpointSlug: 'get-users', dtoSlug: 'error-dto', relation: 'error' });
    expect(all.stored()).toEqual([twoErrors[2]]);
  });

  it('[entity:endpoint-tools-unlink-dto] nothing matching is { unlinked: true } with no write — idempotent; the DTO\'s existence is not checked', async () => {
    const none = rig({ links: twoErrors });
    const res = await none.tool('unlink_dto').handler({ endpointSlug: 'get-users', dtoSlug: 'user-dto', relation: 'error' });
    expect(body(res)).toEqual({ unlinked: true });
    expect(none.update).not.toHaveBeenCalled();
    expect(none.dtoTouched).not.toHaveBeenCalled();

    // A DTO that no longer exists still has its dangling entry removed.
    const gone = rig({ links: twoErrors, dtos: [] });
    const removed = await gone.tool('unlink_dto').handler({ endpointSlug: 'get-users', dtoSlug: 'user-dto', relation: 'response' });
    expect(body(removed)).toEqual({ unlinked: true });
    expect(gone.stored()).toEqual([twoErrors[0], twoErrors[1]]);
  });
});
