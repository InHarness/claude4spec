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
      /**
       * `id` in the path is not `id` in the query — hence the pair. `rekeyOn`
       * is the `name` alone, so moving a parameter from path to query comes
       * back as one `item_rekeyed` on `in` rather than as a removal plus an
       * unrelated-looking addition.
       */
      collection: { kind: 'value', identity: ['name', 'in'], rekeyOn: ['name'] },
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
    /**
     * The screen's MOCKUP — a blob of HTML, and the corpus's second
     * `contentBearing` field after `diagram.source`.
     *
     * On the entity rather than in a page for the reason the DSL moved out to
     * `diagram.source`: the artefact runs to kilobytes, so carrying it in a read
     * record would poison the context of every agent that reads a view, while
     * storing it once lets every reader share it by slug. The flag is the whole
     * mechanism — no read emits it on any surface (`select` included), it stays
     * out of `search_entities` scope, and `get_field_content` issues it. None of
     * that is code here; the host derives all of it from the flag.
     *
     * It ILLUSTRATES the view, it does not define it. Routing truth is `url` +
     * `params[]`, so a mockup that disagrees with them is a legal state nobody
     * validates — not even the client-side `url` ↔ `params` linter, which never
     * reads this field.
     *
     * Nullable and `clearable`, unlike the required `diagram.source`: a view
     * without a mockup is ordinary, and `update_entities({ mockupHtml: null })`
     * is how one is removed. Omitting the field changes nothing, which is what
     * keeps a title edit from wiping a mockup.
     *
     * Written literally — no HTML validation, no trim. A mockup half-finished
     * mid-iteration is a legal state, and the generated write path has no
     * per-type hook to catch it in anyway.
     *
     * LAST, like `designSystemSlug` before it: field order is column order and
     * the baseline gate compares `PRAGMA table_info` positionally.
     */
    mockupHtml: {
      type: 'string',
      column: 'mockup_html',
      clearable: true,
      contentBearing: true,
      description:
        'HTML mockup of the screen. Content-bearing: reads never emit it — fetch it with ' +
        'get_field_content. Null = no mockup; null in an update clears it, omitting it changes nothing.',
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
