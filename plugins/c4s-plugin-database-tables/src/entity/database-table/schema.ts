import type { DataDeclaration, SlugPattern } from '@c4s/plugin-runtime';

/**
 * Host API 2.0.0 — what `database-table` IS.
 *
 * The retired `c4s-plugin-simple-database-tables` spent two migrations, a
 * 636-line service, a CRUD adapter, a hand-written zod module and five Express
 * routes saying what this literal says. None of it comes across: the host
 * derives the projection, the write path, the create/update shapes,
 * snapshot/restore, the diff, rename propagation and the
 * `/api/database-tables` router from this declaration alone.
 *
 * NO `keyFields` ANYWHERE, and that is the whole physical decision.
 *
 * `columns` and `indexes` are ORDERED — the order is part of the table's
 * identity, and a reader scanning a column list is reading a schema, not a set.
 * `keyFields` projects a collection to `UNIQUE(parent, ...key)` rows with no
 * ordinal, so `id, name, email` and `email, id, name` would become the same
 * table. Embedded JSON keeps the array an array. It also keeps the file format
 * the INHERITED one, which is the contract here: this type reads, in place, the
 * `.json` files the retired plugin already wrote across every project.
 *
 * ONE CONSEQUENCE WORTH NAMING. The item field literally called `default` is a
 * reserved SQL word, and it is safe ONLY because `columns` is embedded:
 * `data-schema-validation` runs `assertSqlIdentifier` over the item fields of
 * TABLE-BACKED collections, so the day anyone adds `keyFields` here the type
 * stops registering. `test/registration.test.ts` is the tripwire for that.
 */
export const databaseTableData: DataDeclaration = {
  schema: {
    /**
     * The reserved label — and for THIS type it is the SQL table identifier.
     *
     * The type carried two name fields until 0.2.27, on the reasoning that an
     * identifier and a label are different facts. The corpus never agreed: across
     * 22 entities `title` equalled `name` character for character, not once
     * otherwise. The separation was a distinction nobody drew, so it is gone, and
     * the reserved field absorbs the role.
     *
     * `kind: 'sql-identifier'` is the host's named validator, and the price is
     * named with it: instances of this type never get a human name — not an
     * unused one, an UNWRITABLE one. That is justified only where the instance's
     * name and its technical identifier are genuinely one thing, which is exactly
     * the case here and is not the general case.
     *
     * NO `computedDefault`, deliberately: there is nothing left to derive from,
     * so the field is required outright and a write without it fails input
     * validation.
     */
    title: {
      type: 'string',
      required: true,
      maxLength: 200,
      kind: 'sql-identifier',
      description:
        'SQL table identifier, and the table\'s name — a letter or underscore, then letters, ' +
        'digits or underscores, and never a reserved SQL word. The slug is `slugify(title)`; ' +
        'editing `title` alone does NOT move the slug, a rename travels as `newSlug`.',
    },

    description: {
      type: 'string',
      clearable: true,
      description: 'Prose describing what the table holds and why it exists.',
    },

    /**
     * REQUIRED with no default, so a create that omits it is a 400 rather than
     * a table with no columns. That is the retired plugin's contract
     * (`VALIDATION_ERROR / columns`), and the reason its create dialog and its
     * slash popover both send an explicit `[]`.
     */
    columns: {
      type: 'collection',
      collection: 'value',
      required: true,
      description:
        'Ordered columns. The order is part of the table identity — never sorted, never ' +
        'reshuffled. (No `unordered` flag, deliberately.)',
      item: {
        type: 'object',
        fields: {
          name: {
            type: 'string',
            required: true,
            maxLength: 200,
            description: 'Column identifier.',
          },
          type: {
            type: 'string',
            required: true,
            description: 'Type token as written in the schema — integer, text, uuid, timestamp, …',
          },
          nullable: { type: 'boolean', description: 'The column admits NULL.' },
          unique: { type: 'boolean', description: 'The column carries a UNIQUE constraint.' },
          pk: { type: 'boolean', description: 'The column is part of the primary key.' },
          /**
           * `json`, not `string`. Every default in the corpus today happens to
           * be a string, but the inherited format leaves the value free-form,
           * and `type: 'string'` would turn `default: 0` and `default: false`
           * into create-time rejections of data the format permits.
           */
          default: {
            type: 'json',
            description: 'Default value, as written in the schema. Free-form.',
          },
          enumValues: {
            type: 'collection',
            collection: 'value',
            item: { type: 'string' },
            description: 'Allowed values, when `type` is an enumeration.',
          },
          /**
           * The SOFT foreign key.
           *
           * `ref` + `onMissing: 'warn'` + `onDelete: 'leave-dangling'` is the
           * whole of what the retired `collectDanglingFks` / `softFkFindings` /
           * `describeDanglingFk` trio did — said once, and said to the host,
           * which is the only layer that can also REPOINT it when the target is
           * renamed.
           *
           * No FK constraint is generated, and cannot be: `columns` is embedded
           * JSON, so there is no column for one to sit on. That is precisely why
           * the target is allowed to be absent.
           *
           * `fk.table` holds the target's SLUG. Real corpora are inconsistent
           * about this — some files carry the target's NAME instead
           * (`chat_thread` where the slug is `chat-thread`), which warns and is
           * not repointed on rename. That is the data being wrong, and
           * surfacing it is the point; a one-time adoption pass normalises it.
           */
          fk: {
            type: 'object',
            description:
              'Soft foreign key. A target that does not exist is a WARNING on the write, never ' +
              'a rejection, and deleting the target does not cascade.',
            fields: {
              table: {
                type: 'string',
                required: true,
                ref: 'database-table',
                onMissing: 'warn',
                onDelete: 'leave-dangling',
                description: 'Slug of the referenced database-table. May dangle.',
              },
              column: {
                type: 'string',
                required: true,
                description: 'Column name inside the referenced table.',
              },
            },
          },
          description: { type: 'string', description: 'Prose describing what the column holds.' },
        },
      },
    },

    indexes: {
      type: 'collection',
      collection: 'value',
      description: 'Ordered indexes.',
      item: {
        type: 'object',
        fields: {
          columns: {
            type: 'collection',
            collection: 'value',
            required: true,
            item: { type: 'string' },
            description: 'Indexed column names, in order — the order is the index.',
          },
          unique: { type: 'boolean', description: 'The index is UNIQUE.' },
          /**
           * OPTIONAL, and left optional on purpose. `deriveIndexName` fills a
           * missing name at DISPLAY time; writing it into the payload instead
           * would rewrite authored data on every snapshot.
           */
          name: {
            type: 'string',
            description:
              'Index identifier. Optional — consumers derive `idx_<table>_<cols…>` when absent.',
          },
        },
      },
    },

    createdAt: { type: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { type: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
};

/**
 * `slugify(title)` — the retired plugin's `databaseTableSlugFrom` without its
 * random fallback, which is unreachable once the source cannot be blank.
 *
 * Single-alternative, which is exactly what makes `title` a SLUG SOURCE and
 * therefore non-blank in both generated shapes. See the composition note in
 * `crud-schema-gen`: that rule and the validator above have to hold at once.
 *
 * Unchanged in meaning by the 0.2.27 field merge. The slug was never derived
 * because `title` copied `name`; it is derived because `slugify` is handed the
 * entity's name, and that value now arrives from one field instead of two.
 * Mixed case still collapses: a table titled `Order_Archive` slugs to
 * `order-archive` while the title keeps its capitals.
 */
export const databaseTableSlugPattern: SlugPattern = [{ op: 'slugify', field: 'title' }];
