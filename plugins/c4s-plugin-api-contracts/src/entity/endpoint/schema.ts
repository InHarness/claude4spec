import type { DataDeclaration, SlugPattern } from '@c4s/plugin-runtime';

/** Host API 2.0.0 — what `endpoint` IS. */
export const endpointData: DataDeclaration = {
  schema: {
    /**
     * An ENUM, not a string — the allowlist `EndpointService.requireMethod`
     * enforced, restated as data now that the generated router is the only door.
     *
     * Typed as a plain string, `{ method: 'get' }` and `{ method: 'FETCH' }`
     * were both accepted and stored verbatim, so a list would show `get
     * /api/users` beside `GET /api/orders` and code generated from the spec
     * would carry a verb that does not exist. The retired service also
     * upper-cased its input; that half is deliberately NOT restored — a
     * declaration describes what is valid, it does not silently rewrite the
     * caller's payload, and `POST /api/endpoints { method: 'get' }` now gets a
     * 400 naming the five values instead of a quietly different entity.
     */
    method: {
      kind: 'enum',
      values: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      required: true,
      description: 'HTTP method',
    },
    path: { kind: 'string', required: true, description: 'URL path, e.g. /api/users/:id' },
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
      description:
        'DTOs linked to this endpoint. Full replace, not a diff — `link_dto`/`unlink_dto` are sugar over this collection.',
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
