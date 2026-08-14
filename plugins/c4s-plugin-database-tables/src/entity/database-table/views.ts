import type { SerializationContribution } from '@c4s/plugin-runtime';
import type { RawEntity } from '../../host-kit/host-types.js';
import { DATABASE_TABLE_PATH_PREFIX, DATABASE_TABLE_TYPE } from '../../identity.js';
import { databaseTablePayloadUpgrades } from './upgrades.js';

/** One column of the table, as the inherited file format writes it. */
interface Column {
  name?: string;
  type?: string;
  pk?: boolean;
  fk?: { table?: string; column?: string };
}

const columnsOf = (entity: RawEntity): Column[] =>
  Array.isArray(entity.data.columns) ? (entity.data.columns as Column[]) : [];

const indexCountOf = (entity: RawEntity): number =>
  Array.isArray(entity.data.indexes) ? entity.data.indexes.length : 0;

/**
 * The SHAPE of the table, without the table.
 *
 * Every list view answers the same three questions a reader actually asks of a
 * row — how wide is it, is it indexed, does it have a key — and answers them
 * with counts rather than with the arrays. `genericEntity` would emit the
 * declared fields verbatim, which means shipping all 186 column objects of a
 * corpus to a screen that renders one line per table.
 *
 * `hasPrimaryKey` is the one genuinely derived value: it is not a field, it is a
 * predicate over `columns`, and a table without one is the thing worth spotting
 * from a list.
 */
function summary(entity: RawEntity) {
  const columns = columnsOf(entity);
  return {
    type: DATABASE_TABLE_TYPE,
    slug: entity.slug,
    name: (entity.data.title as string) ?? entity.slug,
    description: (entity.data.description as string | null) ?? null,
    columnCount: columns.length,
    indexCount: indexCountOf(entity),
    hasPrimaryKey: columns.some((c) => c.pk === true),
    tags: entity.tags,
  };
}

export const databaseTableSerializer: SerializationContribution<RawEntity> = {
  payloadVersion: 2,
  /** v1 files predate the reserved `title`; it starts life as a copy of `name`. */
  payloadUpgrades: databaseTablePayloadUpgrades,
  views: {
    /**
     * Labelled by `title`, like every other type since 0.2.22.
     *
     * The reasoning that used to single this type out — "show the SQL
     * identifier, not the kebab slug, because that is what a reader matches
     * against a schema" — is now served by the default: `title` starts as a copy
     * of `name`, so an untouched table still shows `order_items`. What changes
     * is that a table somebody deliberately titled "Order line items" shows
     * that, instead of the identifier overriding the author.
     */
    inline_mention: (entity) => ({
      type: DATABASE_TABLE_TYPE,
      slug: entity.slug,
      label: (entity.data.title as string) ?? entity.slug,
      href: `${DATABASE_TABLE_PATH_PREFIX}/${entity.slug}`,
    }),

    /**
     * THE FULL RECORD, columns and indexes included.
     *
     * This was a counts-only summary, on the reasoning that an inline embed
     * should not bury its surrounding prose under 30 columns. That reasoning
     * was wrong about what `single_element` IS. It is not only the page embed:
     * `discovery/ops/entities.ts` makes it the DEFAULT view of the MCP
     * `read_entities` tool for a single slug, which is how a coding agent
     * resolves a table before writing a migration. Summarising it there hands
     * the agent a column COUNT and no column names, types, nullability or
     * foreign keys — and no page tag can ask for `?view=detail` instead.
     *
     * A `<single_element/>` embedding a table to SHOW its columns is also the
     * ordinary reason to embed one. The retired plugin returned the full record
     * here, and the sibling `dto` envelope still emits its `fields[]`.
     * Presentation belongs to the renderer, which can collapse what it does not
     * want; a view that never sends the data leaves it nothing to collapse.
     */
    single_element: (entity) => ({
      ...summary(entity),
      columns: entity.data.columns ?? [],
      indexes: entity.data.indexes ?? [],
    }),

    /**
     * The LIST views stay summarised, and that distinction is the real one: a
     * list renders one line per table, so shipping every column object of every
     * table is pure waste — 186 of them across a 22-table corpus.
     */
    element_list_item: summary,
    tagged_list_item: summary,
  },
};
