import type { DataDeclaration, SlugPattern } from '@c4s/plugin-runtime';

/** Host API 2.0.0 — what `endpoint` IS. */
export const endpointData: DataDeclaration = {
  schema: {
    method: { kind: 'string', required: true },
    path: { kind: 'string', required: true },
    summary: { kind: 'string', required: true, default: '' },
    description: { kind: 'string', clearable: true },
    createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
    /**
     * The collection that GENERATES the `endpoint_dto` junction.
     *
     * A value collection — read whole, replaced whole on restore — that declares
     * `keyFields`, which is what makes it project to a table of its own instead
     * of to embedded JSON on the endpoint row. `ac.verifies` is the same class of
     * thing (a value collection of ref-carrying objects) without `keyFields`,
     * and stays embedded; that pair is precisely what neither the brief nor the
     * current specification distinguishes, so the distinction is DECLARED here
     * rather than inferred. See the clarification patch filed against this brief.
     *
     * `keyFields` reproduces the junction's historical
     * `UNIQUE(endpoint_slug, dto_slug, relation, status_code)`, and the `ref` on
     * `dto` reproduces its enforced foreign key.
     */
    linkedDtos: {
      kind: 'collection',
      collection: 'value',
      // Link order is not content, and the rows come back in insertion order —
      // so without this, relinking a DTO reorders the endpoint's file.
      unordered: true,
      projectionTable: 'endpoint_dto',
      keyFields: ['dto', 'relation', 'statusCode'],
      item: {
        kind: 'object',
        fields: {
          dto: {
            kind: 'string',
            column: 'dto_slug',
            required: true,
            ref: 'dto',
            onMissing: 'warn',
            onDelete: 'leave-dangling',
          },
          relation: { kind: 'enum', values: ['request', 'response', 'error'], required: true },
          statusCode: { kind: 'number', column: 'status_code' },
        },
      },
    },
  },
};

/** `{method}-{slugify(path)}` — `GET /api/users/:id` → `get-api-users-id`. */
export const endpointSlugPattern: SlugPattern = [
  { op: 'slugify', field: 'method' },
  { op: 'literal', value: '-' },
  { op: 'slugify', field: 'path' },
];
