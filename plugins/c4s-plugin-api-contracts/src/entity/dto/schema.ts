import type { DataDeclaration, SlugPattern } from '@c4s/plugin-runtime';

/** Host API 2.0.0 — what `dto` IS. */
export const dtoData: DataDeclaration = {
  schema: {
    name: { kind: 'string', required: true },
    description: { kind: 'string', clearable: true },
    fields: {
      kind: 'collection',
      collection: 'value',
      item: {
        kind: 'object',
        fields: {
          name: { kind: 'string', required: true },
          /**
           * Deliberately WITHOUT a `ref` flag. The value is polymorphic — either
           * a primitive type name or the slug of another DTO — so a `ref` would
           * make every primitive a broken reference. A nested DTO that has been
           * renamed away therefore degrades to a consistency-check warning
           * rather than to a dangling ref the host tries to repoint.
           */
          type: { kind: 'string', required: true },
          required: { kind: 'boolean', required: true },
          description: { kind: 'string' },
        },
      },
    },
    examples: {
      kind: 'collection',
      collection: 'value',
      item: {
        kind: 'object',
        fields: {
          /**
           * Uniqueness within a DTO is SOFT: no `keyFields`, so no junction and
           * no UNIQUE constraint. The UI blocks a duplicate locally; the write
           * path does not, which retires the hard `EXAMPLE_NAME_CONFLICT`
           * rejection.
           */
          name: { kind: 'string', required: true },
          summary: { kind: 'string' },
          value: { kind: 'record', key: { kind: 'string' }, value: { kind: 'string' } },
        },
      },
    },
    createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
};

/** slugify(name) with PascalCase boundaries — `UserResponse` → `user-response`. */
export const dtoSlugPattern: SlugPattern = [{ op: 'slugify', field: 'name', splitCamelCase: true }];
