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
     * The reserved label — and this is the ONE type where it lives beside a
     * surviving `name`, because the two are genuinely different facts.
     *
     * `name` is a SQL identifier (`order_items`), constrained by a pattern and
     * a reserved-word list, and code is generated from it. `title` is what a
     * person reads. Renaming the identifier to `title` would have made the
     * schema claim that an identifier is a label, and forced either the
     * constraint onto every other type's title or the constraint's removal here.
     *
     * `computedDefault` copies `name`, so nothing has to be authored twice: a
     * table created as `order_items` is titled `order_items` until somebody
     * decides it is really "Order line items".
     */
    title: {
      type: 'string',
      required: true,
      maxLength: 200,
      computedDefault: [{ op: 'raw', field: 'name' }],
      description: 'Human label. Defaults to the SQL identifier in `name`.',
    },
    /**
     * The SQL table identifier, and the slug source.
     *
     * The pattern is case-INSENSITIVE by construction, which is not sloppiness:
     * two rules meet on this field and a strictly-lowercase shape makes the
     * second one unreachable. The name must be an identifier, AND
     * `Order_Items` / `ORDER_ITEMS` / `order_items` must all be creatable and
     * all collapse onto the slug `order-items`. `slugify` does the lowercasing;
     * the shape check has no business repeating it.
     *
     * `notReserved` rather than folding the word list into the pattern: it is
     * set membership, not shape, and it earns its own message. The host owns
     * the list, so this cannot drift from what the host enforces elsewhere.
     */
    name: {
      type: 'string',
      required: true,
      pattern: '^[A-Za-z_][A-Za-z0-9_]*$',
      notReserved: 'sql',
      // 0.2.22 — bounded at last. An identifier had no length limit at all,
      // which no database agrees with; 200 matches the host's title bound so
      // the two constraints on this entity read the same way.
      maxLength: 200,
      description:
        'SQL table identifier — a letter or underscore, then letters, digits or underscores, ' +
        'and never a reserved SQL word. The slug is `slugify(name)`; editing `name` alone does ' +
        'NOT move the slug, a rename travels as `newSlug`.',
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
 * `slugify(name)` — the retired plugin's `databaseTableSlugFrom` without its
 * random fallback, which is unreachable once `name` cannot be blank.
 *
 * Single-alternative, which is exactly what makes `name` a SLUG SOURCE and
 * therefore non-blank in both generated shapes. See the composition note in
 * `crud-schema-gen`: that rule and the two flags above have to hold at once.
 */
export const databaseTableSlugPattern: SlugPattern = [{ op: 'slugify', field: 'title' }];
