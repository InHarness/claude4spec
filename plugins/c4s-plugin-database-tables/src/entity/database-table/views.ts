import type { SerializationContribution } from '@c4s/plugin-runtime';
import type { RawEntity } from '../../host-kit/host-types.js';
import { DATABASE_TABLE_PATH_PREFIX, DATABASE_TABLE_TYPE } from '../../identity.js';

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
    name: (entity.data.name as string) ?? entity.slug,
    description: (entity.data.description as string | null) ?? null,
    columnCount: columns.length,
    indexCount: indexCountOf(entity),
    hasPrimaryKey: columns.some((c) => c.pk === true),
    tags: entity.tags,
  };
}

export const databaseTableSerializer: SerializationContribution<RawEntity> = {
  views: {
    /**
     * Labelled by `name`, NOT by slug.
     *
     * The slug is kebab (`order-items`); the name is the actual SQL identifier
     * (`order_items`), and that is what a reader following a mention into a
     * schema needs to match against. The retired serializer made the same
     * choice and it is the one visible difference from the generic view.
     */
    inline_mention: (entity) => ({
      type: DATABASE_TABLE_TYPE,
      slug: entity.slug,
      label: (entity.data.name as string) ?? entity.slug,
      href: `${DATABASE_TABLE_PATH_PREFIX}/${entity.slug}`,
    }),

    /**
     * Embedded in a page: the table SUMMARISED, not enumerated.
     *
     * A `database-table` embed sits inline in prose. Expanding 30 columns there
     * buries the sentence around it — the reader wants "this is a 30-column
     * table with a key", and follows the link when they want the columns.
     */
    single_element: summary,

    element_list_item: summary,
    tagged_list_item: summary,
  },
};
