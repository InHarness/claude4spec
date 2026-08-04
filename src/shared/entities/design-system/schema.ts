import type { DataDeclaration, FieldNode } from '../../plugin-host/data-schema.js';
import type { SlugPattern } from '../../plugin-host/slug-pattern.js';

/**
 * A token value is a literal ("#2563eb"), an alias ("{brand-primary}") or a
 * composite object (typography, shadow) whose keys are the composite's own
 * vocabulary and are not fixed by this schema.
 *
 * 0.2.9 (item 27) — was `record<string, string>`, which declared ONLY the
 * composite arm. That was survivable while the declaration merely described the
 * read payload, and became a rejection the moment it started validating writes:
 * `value: "#2563eb"` — the commonest token there is — would have failed the
 * generated create schema. `json` says what is actually true, which is that the
 * host does not interpret this value at all.
 */
const tokenValue: FieldNode = {
  kind: 'json',
  description:
    'Literal ("#2563eb", "16px"), an alias "{token-name}", or a composite object (typography/shadow).',
};

/** Host API 2.0.0 — what `design-system` IS. */
export const designSystemData: DataDeclaration = {
  schema: {
    name: { kind: 'string', required: true, description: 'Display name (e.g. "Brand 2026")' },
    description: { kind: 'string', clearable: true },
    groups: {
      kind: 'collection',
      collection: 'value',
      description: 'Token groups (default []).',
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
                name: { kind: 'string', required: true, description: 'Token name, unique within the design system' },
                type: {
                  kind: 'string',
                  required: true,
                  description:
                    'TokenType (color|dimension|fontSize|...|typography|shadow). Best-effort, not hard-validated.',
                },
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
      description: 'Theme modes — token override sets (default []).',
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
