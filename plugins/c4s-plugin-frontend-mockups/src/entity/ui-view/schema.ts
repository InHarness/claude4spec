import type { DataDeclaration, SlugPattern } from '@c4s/plugin-runtime';

/**
 * Host API 2.0.0 — what `ui-view` IS.
 *
 * `designSystemSlug` is deliberately LAST: the historical chain appended it via
 * `ALTER TABLE` in `037`, and the baseline-identity gate compares
 * `PRAGMA table_info` positionally. Field order here is column order.
 */
export const uiViewData: DataDeclaration = {
  schema: {
    /**
     * Was `name`. `params[].name` is untouched — it names a parameter, not the
     * view.
     */
    title: {
      type: 'string',
      required: true,
      maxLength: 200,
      description: 'Display name (e.g. "User Profile Screen")',
    },
    url: {
      type: 'string',
      clearable: true,
      description: 'Route pattern (e.g. "/users/:id"). Null/omitted = modal/drawer without routing.',
    },
    description: { type: 'string', clearable: true },
    params: {
      type: 'collection',
      collection: 'value',
      item: {
        type: 'object',
        fields: {
          name: { type: 'string', required: true, description: 'Parameter name (no `:` prefix)' },
          in: {
            type: 'enum',
            values: ['path', 'query', 'hash'],
            required: true,
            description: 'Where the param lives',
          },
          type: { type: 'string', description: 'Suggested value type (string|int|uuid|enum|...)' },
          required: { type: 'boolean' },
          default: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    createdAt: { type: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { type: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
    /**
     * The flag set that replaces a hand-written rename hook, a hand-written
     * nullable Zod field and a hand-written dangling-reference warning:
     * `ref` drives propagation, `clearable` is what makes `null` legal in an
     * update, and `onMissing`/`onDelete` say a dangling design system warns
     * rather than blocks.
     */
    designSystemSlug: {
      type: 'string',
      column: 'design_system_slug',
      ref: 'design-system',
      clearable: true,
      onMissing: 'warn',
      onDelete: 'leave-dangling',
      description:
        'Slug of a design-system this view uses (no FK; dangling allowed). Null = detach. Omit = unchanged.',
    },
  },
};

/**
 * slugify(title) with PascalCase boundaries — `UserProfile` → `user-profile`.
 * Identical output to the retired `slugify(name)`; nothing re-slugs.
 */
export const uiViewSlugPattern: SlugPattern = [
  { op: 'slugify', field: 'title', splitCamelCase: true },
];
