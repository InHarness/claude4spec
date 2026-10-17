import type { DataDeclaration, SlugPattern } from '@c4s/plugin-runtime';
import { UI_KIT_BINDINGS, UI_KIT_COMPONENT_TYPE, UI_KIT_DATA_SOURCE_USAGES, UI_KIT_GROUPS, UI_KIT_STABILITIES } from '../../identity.js';

/**
 * The logical schema of `ui-kit-component` (c4s-plugin-host-ui-kit-components
 * `8kvfhgsj`): four required fields, four collections, three optional fields,
 * plus the reserved `title`. What each field MEANS (the `binding` doctrine, the
 * scope of a `stability` tier) lives in the L12 slice schema (`l12slice0`);
 * this is only the shape.
 *
 * `group`, `stability` and `binding` are required enums WITHOUT a default: a
 * record missing its classification is refused at the generated doors (REST and
 * `entity-tools`) instead of being created with a guessed tier or binding
 * (`l12slice0`: "rekord bez któregokolwiek z nich nie powstaje").
 *
 * Field order is the column order of the generated table.
 */
export const uiKitComponentData: DataDeclaration = {
  schema: {
    /** Reserved title (M13 `eo2he5du`); defaults to `name` at create, overridable. */
    title: {
      type: 'string',
      required: true,
      maxLength: 200,
      computedDefault: [
        { op: 'raw', field: 'name' },
        // `name` is bounded at 100, so this never cuts — it states the bound where the value is made.
        { op: 'truncate', n: 200 },
      ],
    },
    name: {
      type: 'string',
      required: true,
      maxLength: 100,
      // At least one non-whitespace character.
      kind: 'non-empty',
      description: 'The export name from @c4s/plugin-runtime/ui, verbatim, in PascalCase. The slug is derived from it once, at create.',
    },
    group: {
      type: 'enum',
      values: UI_KIT_GROUPS,
      required: true,
      description: 'Catalog group. The value order is the group order of the type list.',
    },
    stability: {
      type: 'enum',
      values: UI_KIT_STABILITIES,
      required: true,
      description: 'Tier of the component contract towards plugins. Changing `props` of a `stable` component needs a Host API changelog entry.',
    },
    binding: {
      type: 'enum',
      values: UI_KIT_BINDINGS,
      required: true,
      description:
        'presentational = props-in, no access to the live host; connected = the component fetches host-owned data through L11 itself and must name it in `dataSources` with usage fetchedByComponent.',
    },
    props: {
      type: 'collection',
      collection: { kind: 'value', identity: ['name'] },
      description: 'The props contract, in prop order; one element per prop name.',
      item: {
        type: 'object',
        fields: {
          name: { type: 'string', required: true },
          type: { type: 'string', required: true, description: 'The literal TypeScript type.' },
          required: { type: 'boolean', required: true },
          default: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    types: {
      type: 'collection',
      collection: { kind: 'value', identity: ['name'] },
      description: 'Helper types of the contract. A type is defined by exactly one record.',
      item: {
        type: 'object',
        fields: {
          name: { type: 'string', required: true },
          definition: { type: 'string', required: true },
        },
      },
    },
    dataSources: {
      type: 'collection',
      // No identity declared (`yhej76w5`): items are matched by index.
      collection: { kind: 'value' },
      description:
        'Host data sources: `export` is a name from the @c4s/plugin-runtime inventory; `usage` is fetchedByComponent (the component fetches it itself — connected only) or feedsProps.',
      item: {
        type: 'object',
        fields: {
          export: { type: 'string', required: true },
          usage: { type: 'enum', values: UI_KIT_DATA_SOURCE_USAGES, required: true },
        },
      },
    },
    composes: {
      type: 'collection',
      collection: { kind: 'value' },
      description: 'Catalog components this one is composed of (slugs of other ui-kit-component records).',
      item: {
        type: 'object',
        fields: {
          component: {
            type: 'string',
            required: true,
            ref: UI_KIT_COMPONENT_TYPE,
            onMissing: 'warn',
            onDelete: 'leave-dangling',
          },
        },
      },
    },
    soleAnatomyOf: {
      type: 'string',
      clearable: true,
      maxLength: 100,
      description:
        'Kebab-case anatomy pattern this record is the only implementation of. Open vocabulary; uniqueness is checked by audit_ui_kit_components.',
    },
    behavior: {
      type: 'string',
      clearable: true,
      maxLength: 20000,
      description:
        'Markdown in fixed bold-led paragraphs, in this order and only those with content: **Zachowanie**, **Czego nie ma**, **Alternatywy**, **Uzasadnienie**.',
    },
    anatomy: {
      type: 'string',
      clearable: true,
      contentBearing: true,
      description:
        'Markdown: dimensions, colours, layers, focus trap, tokens. Content-bearing: reads never emit it — fetch it with get_field_content.',
    },
    createdAt: { type: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { type: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
  access: [{ filter: ['group'] }, { filter: ['binding'] }],
};

/**
 * The slug is `name` in kebab-case (`TagFilterBar` → `tag-filter-bar`), computed
 * once at create and never recomputed (`esn4za5k`).
 */
export const uiKitComponentSlugPattern: SlugPattern = [{ op: 'slugify', field: 'name', splitCamelCase: true }];
