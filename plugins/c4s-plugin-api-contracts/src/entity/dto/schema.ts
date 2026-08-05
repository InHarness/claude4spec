import type { DataDeclaration, SlugPattern } from '@c4s/plugin-runtime';

/** Host API 2.0.0 — what `dto` IS. */
export const dtoData: DataDeclaration = {
  schema: {
    name: { kind: 'string', required: true, description: 'DTO name (PascalCase, e.g. UserResponse)' },
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
      description: 'Named payload exemplars. Soft-validated. name unique within DTO.',
      item: {
        kind: 'object',
        fields: {
          /**
           * Uniqueness within a DTO is SOFT: no `keyFields`, so no junction and
           * no UNIQUE constraint. The UI blocks a duplicate locally; the write
           * path does not, which retires the hard `EXAMPLE_NAME_CONFLICT`
           * rejection.
           */
          name: {
            kind: 'string',
            required: true,
            description: 'Identifier unique within DTO (e.g. "minimal", "full", "edge-case")',
          },
          summary: { kind: 'string' },
          /**
           * 0.2.9 (item 27) — was `record<string, string>`, which admitted
           * neither a number nor a nested object. An exemplar is a payload
           * "as-is": the retired hand-written schema said `z.unknown()`, and
           * `json` is that same statement made declaratively. Soft-validated
           * against `fields[]` at presentation time, never on the write path.
           */
          value: {
            kind: 'json',
            description: 'Payload as-is. Soft-validated against fields[] (warning only).',
          },
        },
      },
    },
    createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
};

/** slugify(name) with PascalCase boundaries — `UserResponse` → `user-response`. */
export const dtoSlugPattern: SlugPattern = [{ op: 'slugify', field: 'name', splitCamelCase: true }];
