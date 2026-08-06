import type { EntityDiff, SerializationContribution, SnapshotData } from '@c4s/plugin-runtime';
import type { RawEntity, ReaderLike } from '../../host-kit/host-types.js';
import { CELLS_FIELD, SPREADSHEET_PATH_PREFIX, SPREADSHEET_TYPE } from '../../identity.js';
import { buildOverview, cellLookup, metaOf, toSparseCells } from './overview.js';
import { spreadsheetPayloadUpgrades } from './upgrades.js';

/**
 * Two views, a diff, and the payload chain.
 *
 * Every view NOT listed here is served generically from `data.schema` — which
 * for this type is most of them: `single_element`, `element_list_item` and
 * `tagged_list_item` were the same three-field projection in v1 and the host
 * now produces them identically. `snapshot` and `restore` are not slots any
 * more at all; the host generates both, and its keyed snapshot (sparse, sorted,
 * empties dropped) is the shape this type's files are migrated INTO. See
 * `upgrades.ts`.
 */

function detailFields(overview: ReturnType<typeof buildOverview>): Array<{ label: string; value: string }> {
  const fields = [
    { label: 'Slug', value: overview.slug },
    { label: 'Name', value: overview.name },
    { label: 'Rows', value: String(overview.nRows) },
    { label: 'Columns', value: String(overview.nCols) },
    { label: 'Header row', value: overview.headerRow ? 'yes' : 'no' },
    { label: 'Header column', value: overview.headerCol ? 'yes' : 'no' },
  ];
  if (overview.headerRowLabels) {
    fields.push({ label: 'Header row labels', value: overview.headerRowLabels.join(' | ') });
  }
  if (overview.headerColLabels) {
    fields.push({ label: 'Header column labels', value: overview.headerColLabels.join(' | ') });
  }
  return fields;
}

const DIFF_KEYS = ['name', 'nRows', 'nCols', 'headerRow', 'headerCol', 'cells'] as const;

function spreadsheetDiff(a: SnapshotData, b: SnapshotData, slug: string): EntityDiff {
  const left = (a ?? null) as Record<string, unknown> | null;
  const right = (b ?? null) as Record<string, unknown> | null;
  const changes: Record<string, unknown> = {};
  for (const key of DIFF_KEYS) {
    const from = left?.[key];
    const to = right?.[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
  }
  const op = left == null ? 'created' : right == null ? 'deleted' : Object.keys(changes).length ? 'modified' : 'noop';
  return { type: SPREADSHEET_TYPE, slug, op, changes };
}

export const spreadsheetSerializer: SerializationContribution<RawEntity> = {
  views: {
    /**
     * Stays a slot because `label` and `href` are a rendering decision rather
     * than fields — nothing in `data.schema` says a mention shows the name and
     * links to the (nonexistent) detail page.
     */
    inline_mention: (entity) => ({
      kind: 'inline_mention',
      type: SPREADSHEET_TYPE,
      slug: entity.slug,
      label: metaOf(entity).name || entity.slug,
      href: `${SPREADSHEET_PATH_PREFIX}/${entity.slug}`,
    }),

    /**
     * `detail` IS THE OVERVIEW, and the omission is the feature.
     *
     * A generic detail view would carry the whole `cells` collection, which for
     * this type is the one thing a reader must never receive by accident: a
     * 200×40 sheet is 8 000 cells of prose, and the only way to make
     * overview-first a real discipline rather than advice is for the cheap read
     * to be the ONLY read that arrives unasked. Body cells come back solely
     * through an explicit windowed range read.
     *
     * The perimeter labels are the deliberate exception — see `buildOverview`.
     */
    detail: (entity, reader) => {
      const meta = metaOf(entity);
      if (!meta.headerRow && !meta.headerCol) {
        return { kind: 'detail', type: SPREADSHEET_TYPE, slug: meta.slug, title: meta.name, fields: detailFields(meta) };
      }
      /*
       * `readCollection` answers the whole collection, and there is no narrower
       * primitive on the published reader — the host exposes no perimeter or
       * window read to a serializer. The cells are filtered to the perimeter
       * here and nothing else escapes this function, so the OUTPUT contract
       * (shape plus labels, never body) holds regardless; what it costs is one
       * full read of an index that is already in SQLite.
       */
      const cells = toSparseCells((reader as unknown as ReaderLike).readCollection(SPREADSHEET_TYPE, meta.slug, CELLS_FIELD));
      const perimeter = cells.filter((cell) => cell.r === 1 || cell.c === 1);
      const overview = buildOverview(meta, cellLookup(perimeter));
      return {
        kind: 'detail',
        type: SPREADSHEET_TYPE,
        slug: overview.slug,
        title: overview.name,
        fields: detailFields(overview),
      };
    },
  },

  diff: spreadsheetDiff,

  /**
   * The dense→sparse migration. `payloadVersion` is declared on the manifest
   * (which is the authority); echoing it here keeps the two visible together,
   * and registration refuses the pair if the chain length disagrees.
   */
  payloadVersion: 2,
  payloadUpgrades: spreadsheetPayloadUpgrades,
};
