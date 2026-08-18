import type { SerializationContribution } from '@c4s/plugin-runtime';
import type { RawEntity } from '../../host-kit/host-types.js';
import { spreadsheetPayloadUpgrades } from './upgrades.js';

/**
 * The payload chain — nothing else.
 *
 * `snapshot` and `restore` stopped being slots in 0.2.9 (the host generates
 * both, and its keyed snapshot — sparse, sorted, empties dropped — is the shape
 * this type's files are migrated INTO; see `upgrades.ts`). The views followed in
 * 0.2.23, and `diff` in 0.2.31: `cells` is a KEYED collection, so the host
 * matches its items by the `keyFields` that already address them and needs
 * nothing from this file to do it.
 */

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
  /**
   * The dense→sparse migration. `payloadVersion` is declared on the manifest,
   * which is the authority — the echo that used to sit here went with the
   * wrapper, and registration still refuses a chain whose length disagrees.
   */
  payloadUpgrades: spreadsheetPayloadUpgrades,
} satisfies Pick<SerializationContribution<RawEntity>, 'payloadUpgrades'>;
