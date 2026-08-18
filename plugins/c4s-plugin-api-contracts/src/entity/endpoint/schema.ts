import type { DataDeclaration, SlugPattern } from '@c4s/plugin-runtime';

/** Host API 2.0.0 — what `endpoint` IS. */
export const endpointData: DataDeclaration = {
  schema: {
    /**
     * `"{method} {path}"`, derived once at create.
     *
     * `method` and `path` STAY as domain fields — they are how a route is
     * addressed, filtered and generated from, and folding them into one string
     * would make every consumer parse the title back apart. What the reserved
     * field replaces is the hardcoded `` `${method} ${path}` `` that four
     * separate renderers each assembled for themselves.
     *
     * `raw`, not `slugify`: this is the label. `GET /orders/{id}` reads as a
     * route; `get-orders-id` is the slug, and the pattern below still builds it.
     */
    title: {
      type: 'string',
      required: true,
      maxLength: 200,
      computedDefault: [
        { op: 'raw', field: 'method' },
        { op: 'literal', value: ' ' },
        { op: 'raw', field: 'path' },
        /**
         * The same 200 the field declares, applied where the value is MADE.
         *
         * Derived values are filled after the create body has been validated,
         * so a `maxLength` cannot catch one — a long enough `path` would store
         * a title that violates the type's own constraint, and the next
         * unrelated update would be refused for a field the caller never
         * touched. Deriving within the bound is what keeps that impossible.
         */
        { op: 'truncate', n: 200 },
      ],
      description: 'Label. Defaults to "{method} {path}", e.g. "GET /orders/{id}".',
    },
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
      type: 'enum',
      values: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      required: true,
      description: 'HTTP method',
    },
    path: { type: 'string', required: true, description: 'URL path, e.g. /api/users/:id' },
    summary: { type: 'string', required: true, default: '' },
    description: { type: 'string', clearable: true },
    createdAt: { type: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { type: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
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
      type: 'collection',
      collection: 'value',
      // Link order is not content, and the rows come back in insertion order —
      // so without this, relinking a DTO reorders the endpoint's file.
      unordered: true,
      description:
        'DTOs linked to this endpoint. Full replace, not a diff — `link_dto`/`unlink_dto` are sugar over this collection.',
      projectionTable: 'endpoint_dto',
      keyFields: ['dto', 'relation', 'statusCode'],
      item: {
        type: 'object',
        fields: {
          dto: {
            type: 'string',
            column: 'dto_slug',
            required: true,
            ref: 'dto',
            onMissing: 'warn',
            onDelete: 'leave-dangling',
          },
          relation: { type: 'enum', values: ['request', 'response', 'error'], required: true },
          statusCode: { type: 'number', column: 'status_code' },
        },
      },
    },
  },
};

/**
 * `slugify(title)` — `GET /api/users/:id` → `get-api-users-id`.
 *
 * Same output as the retired `{method}-{slugify(path)}`, because `title`
 * defaults to `"{method} {path}"` and slugifying a space yields the same hyphen
 * the literal used to supply. An endpoint created before and after this release
 * from the same method and path gets the same slug.
 */
export const endpointSlugPattern: SlugPattern = [{ op: 'slugify', field: 'title' }];
