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
      /**
       * 0.2.55 — the LIST takes `paramsCount`, not the parameters.
       *
       * The list row has only ever rendered the number. Shipping every
       * parameter to print it made the row's cost grow with a view's
       * complexity, for nothing a reader of the list can see. The detail read is
       * untouched and still carries the array.
       */
      listOverview: true,
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
    /**
     * The view's ALTERNATIVE SCREEN STATES — `empty`, `loading`, `error` — as
     * domain data rather than as a comment inside the mockup.
     *
     * 0.2.49 reverses the earlier framing that deferred states to a future
     * `ui-component` entity. They are a field of the VIEW: the mockup document
     * turns `?state=<name>` into `data-preview-state="<name>"` on `<html>`, so a
     * variant costs one query param and no JavaScript at all. The `<script>`
     * slot that was reserved for a "preview-state harness" is gone with it.
     *
     * The DEFAULT STATE IS NOT AN ENTRY. This collection enumerates only the
     * deviations from what the mockup renders with no attribute set, which is
     * why `states: []` is both legal and typical.
     *
     * `identity: ['name']` and NO `rekeyOn`: unlike `params[]`, whose identity is
     * the `('name','in')` pair and whose `rekeyOn` turns a path→query move into
     * one `item_rekeyed`, a state's identity is one field. There is no second
     * axis to move along, so a one-level match is the whole story and
     * `item_rekeyed` never appears.
     *
     * The `[a-z0-9-]+` pattern on `name` is advice the client-side linter gives,
     * not a constraint enforced here — the SECURITY boundary is at the mockup
     * route, which whitelists the value before it reaches an HTML attribute. A
     * name outside the class is storable; it is simply unaddressable.
     *
     * Divergence between what this declares and what the mockup actually
     * illustrates is legal and unvalidated — exactly like the existing
     * `url`/`params[]` divergence from the mockup.
     *
     * LAST, like `mockupHtml` before it: field order is column order and the
     * baseline gate compares `PRAGMA table_info` positionally.
     */
    states: {
      type: 'collection',
      collection: { kind: 'value', identity: ['name'] },
      item: {
        type: 'object',
        fields: {
          name: {
            type: 'string',
            required: true,
            description:
              'State identifier, pattern [a-z0-9-]+ — it becomes ?state= and the ' +
              'data-preview-state attribute. The default state is NOT listed here.',
          },
          label: { type: 'string', description: 'Label shown in the preview variant box' },
          description: {
            type: 'string',
            description:
              'What the state MEANS in the domain — specification content, not a hint for the mockup generator.',
          },
        },
      },
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
