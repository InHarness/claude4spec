import type { DataDeclaration } from '../../plugin-host/data-schema.js';
import type { SlugPattern } from '../../plugin-host/slug-pattern.js';

/**
 * Host API 2.0.0 — what `ui-view` IS.
 *
 * `designSystemSlug` is deliberately LAST: the historical chain appended it via
 * `ALTER TABLE` in `037`, and the baseline-identity gate compares
 * `PRAGMA table_info` positionally. Field order here is column order.
 */
export const uiViewData: DataDeclaration = {
  schema: {
    name: { kind: 'string', required: true },
    url: { kind: 'string', clearable: true },
    description: { kind: 'string', clearable: true },
    params: {
      kind: 'collection',
      collection: 'value',
      item: {
        kind: 'object',
        fields: {
          name: { kind: 'string', required: true },
          in: { kind: 'enum', values: ['path', 'query', 'hash'], required: true },
          type: { kind: 'string' },
          required: { kind: 'boolean' },
          default: { kind: 'string' },
          description: { kind: 'string' },
        },
      },
    },
    createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
    /**
     * The flag set that replaces a hand-written rename hook, a hand-written
     * nullable Zod field and a hand-written dangling-reference warning:
     * `ref` drives propagation, `clearable` is what makes `null` legal in an
     * update, and `onMissing`/`onDelete` say a dangling design system warns
     * rather than blocks.
     */
    designSystemSlug: {
      kind: 'string',
      column: 'design_system_slug',
      ref: 'design-system',
      clearable: true,
      onMissing: 'warn',
      onDelete: 'leave-dangling',
    },
  },
};

/** slugify(name) with PascalCase boundaries — `UserProfile` → `user-profile`. */
export const uiViewSlugPattern: SlugPattern = [
  { op: 'slugify', field: 'name', splitCamelCase: true },
];
