import type { EntityDiff, SerializationContribution, SnapshotData } from '@c4s/plugin-runtime';
import type { RawEntity } from '../../host-kit/host-types.js';
import { SPREADSHEET_TYPE } from '../../identity.js';
import { spreadsheetPayloadUpgrades } from './upgrades.js';

/**
 * A diff and the payload chain — nothing else.
 *
 * `snapshot` and `restore` stopped being slots in 0.2.9 (the host generates
 * both, and its keyed snapshot — sparse, sorted, empties dropped — is the shape
 * this type's files are migrated INTO; see `upgrades.ts`). The views followed in
 * 0.2.23.
 */

const DIFF_KEYS = ['title', 'nRows', 'nCols', 'headerRow', 'headerCol', 'cells'] as const;

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

/**
 * 0.2.23 — the `detail` view is gone, and with it the perimeter labels.
 *
 * That view returned an OVERVIEW instead of the type's fields, on the reasoning
 * that a generic read would otherwise carry the whole `cells` collection — 8 000
 * cells of prose for a 200x40 sheet. The reasoning survives; the mechanism was
 * the wrong one. `cells` is declared a KEYED collection, so the host already
 * refuses to materialise it and emits only its overview: the discipline is now a
 * property of the declaration rather than of a function this type wrote.
 *
 * What the view added on top — the first row's and first column's header labels
 * — leaves the record entirely. An overview of a keyed collection is its SHAPE,
 * not a sample of its contents, and the labels are contents. They have one home
 * now, `spreadsheet-tools`' `get_overview`, alongside the dimensions and the
 * header flags. `n_rows` / `n_cols` / `header_row` / `header_col` are ordinary
 * schema fields and come back in the record for free.
 */
/** 0.2.24 — spread onto the type; the `serializer` wrapper is rejected now. */
export const spreadsheetSerialization = {
  diff: spreadsheetDiff,

  /**
   * The dense→sparse migration. `payloadVersion` is declared on the manifest,
   * which is the authority — the echo that used to sit here went with the
   * wrapper, and registration still refuses a chain whose length disagrees.
   */
  payloadUpgrades: spreadsheetPayloadUpgrades,
} satisfies Pick<SerializationContribution<RawEntity>, 'payloadUpgrades' | 'diff'>;
