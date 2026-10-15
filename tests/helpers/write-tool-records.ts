/**
 * 2.1.26 — the `mcp-tool` records of the M13 entity-mutation tools and the two
 * DTO-binding tools, as the specification states them at release 2.1.26: name,
 * server, the description the model reads, and the declared parameters. Copied
 * from the records, not from the code — the tests that read this file hold the
 * registered tools against it.
 *
 * Every hint of every record here is empty: the servers declare none.
 */

import { expect } from 'vitest';
import { declaredParams, type DeclaredTool } from './read-tool-records.js';

export interface WriteToolRecord {
  server: 'entity-tools' | 'endpoint-tools';
  name: string;
  description: string;
  params: Array<{ name: string; type: string; required: boolean; description?: string }>;
}

const DTO_LINK_PARAMS: WriteToolRecord['params'] = [
  { name: 'endpointSlug', type: 'string', required: true },
  { name: 'dtoSlug', type: 'string', required: true },
  { name: 'relation', type: 'enum(request, response, error)', required: true },
  { name: 'statusCode', type: 'number', required: false },
];

export const WRITE_TOOL_RECORDS: Record<string, WriteToolRecord> = {
  'entity-tools-create-entities': {
    server: 'entity-tools',
    name: 'create_entities',
    description:
      "Create one or more entities of the given type in a single batch. Each item is validated against the type's createSchema (see describe_entity_type). Non-transactional: one item failing (e.g. duplicate slug) does not roll back the others. Returns { results: [{ slug } | { error, code }] } in input order.",
    params: [
      { name: 'type', type: 'string', required: true, description: 'Entity type, e.g. "endpoint"' },
      { name: 'items', type: 'object[]', required: true, description: "Items to create, each matching the type's createSchema" },
    ],
  },
  'entity-tools-update-entities': {
    server: 'entity-tools',
    name: 'update_entities',
    description:
      "Update one or more entities in a single batch. `data` is validated against the type's updateSchema (partial by default). The slug is stable — pass an explicit `newSlug` to rename (collision → SLUG_CONFLICT); a rename propagates to every markdown reference. Non-transactional. Returns { results: [{ slug } | { error, code }] } in input order (slug is the NEW slug if renamed).",
    params: [
      { name: 'type', type: 'string', required: true },
      { name: 'updates', type: 'object[]', required: true },
    ],
  },
  'entity-tools-delete-entities': {
    server: 'entity-tools',
    name: 'delete_entities',
    description:
      'Delete one or more entities in a single batch. Returns broken markdown references per deleted item. Non-transactional. Returns { results: [{ deleted: true, brokenReferences } | { error, code }] } in input order.',
    params: [
      { name: 'type', type: 'string', required: true },
      { name: 'slugs', type: 'string[]', required: true },
    ],
  },
  'endpoint-tools-link-dto': {
    server: 'endpoint-tools',
    name: 'link_dto',
    description:
      'Link a DTO to an endpoint as request body, response, or error response. Optional HTTP status code for response/error. Idempotent.',
    params: DTO_LINK_PARAMS,
  },
  'endpoint-tools-unlink-dto': {
    server: 'endpoint-tools',
    name: 'unlink_dto',
    description: 'Remove a DTO link from an endpoint. Omit statusCode to remove all links (endpoint, dto, relation).',
    params: DTO_LINK_PARAMS,
  },
};

/**
 * The registered tool matches its record: name, description verbatim, the
 * parameter set with each one's type, requiredness and description, and no
 * declared hint (every hint of these records is empty).
 */
export function expectToolMatchesWriteRecord(tool: DeclaredTool | undefined, slug: string): void {
  const record = WRITE_TOOL_RECORDS[slug];
  expect(record, `record ${slug}`).toBeDefined();
  expect(tool, `tool ${record!.server} · ${record!.name}`).toBeDefined();
  expect(tool!.name).toBe(record!.name);
  expect(tool!.description).toBe(record!.description);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  expect([...declaredParams(tool!)].sort(byName)).toEqual([...record!.params].sort(byName));
  expect(tool!.annotations ?? {}).toEqual({});
}
