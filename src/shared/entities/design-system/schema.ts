import type { DataDeclaration, FieldNode } from '../../plugin-host/data-schema.js';
import type { SlugPattern } from '../../plugin-host/slug-pattern.js';

/**
 * A token value is a literal ("#2563eb"), an alias ("{brand-primary}") or a
 * composite object (typography, shadow). The composite arm is a `record` of
 * string → string rather than an `object`, because its keys are the composite's
 * own vocabulary and are not fixed by this schema. Declaring the key schema is
 * what keeps the branch visible to the search deriver, which used to skip map
 * nodes silently for want of one.
 */
const tokenValue: FieldNode = { kind: 'record', key: { kind: 'string' }, value: { kind: 'string' } };

/** Host API 2.0.0 — what `design-system` IS. */
export const designSystemData: DataDeclaration = {
  schema: {
    name: { kind: 'string', required: true },
    description: { kind: 'string', clearable: true },
    groups: {
      kind: 'collection',
      collection: 'value',
      // A group's identity is its name, so reordering groups is a noop — but an
      // unsorted snapshot would still churn the file. `tokens` below is
      // deliberately NOT unordered: a sm/md/xl scale's order is documentation.
      unordered: true,
      item: {
        kind: 'object',
        fields: {
          name: { kind: 'string', required: true },
          tier: { kind: 'enum', values: ['primitive', 'semantic'], required: true },
          tokens: {
            kind: 'collection',
            collection: 'value',
            item: {
              kind: 'object',
              fields: {
                name: { kind: 'string', required: true },
                type: { kind: 'string', required: true },
                value: tokenValue,
                description: { kind: 'string' },
              },
            },
          },
        },
      },
    },
    modes: {
      kind: 'collection',
      collection: 'value',
      // Same rule as `groups`; `overrides` stays authored.
      unordered: true,
      item: {
        kind: 'object',
        fields: {
          name: { kind: 'string', required: true },
          overrides: {
            kind: 'collection',
            collection: 'value',
            item: {
              kind: 'object',
              fields: {
                token: { kind: 'string', required: true },
                value: tokenValue,
              },
            },
          },
        },
      },
    },
    createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
};

/** slugify(name) with PascalCase boundaries — matches the retired `designSystemSlug`. */
export const designSystemSlugPattern: SlugPattern = [
  { op: 'slugify', field: 'name', splitCamelCase: true },
];
