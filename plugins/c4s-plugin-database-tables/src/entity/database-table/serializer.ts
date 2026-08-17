import type { SerializationContribution } from '@c4s/plugin-runtime';
import type { RawEntity } from '../../host-kit/host-types.js';
import { databaseTablePayloadUpgrades } from './upgrades.js';

/**
 * 0.2.23 — the type that overrode the most views now overrides none.
 *
 * Four went: `inline_mention`, `single_element` and the two list items. The
 * three values behind them — `columnCount`, `indexCount` and `hasPrimaryKey` —
 * are not fields, they are arithmetic over `columns[]` and `indexes[]`, and
 * arithmetic over a collection the record already carries belongs to whoever
 * renders it. `frontend/list-row.tsx` and `frontend/render-card.tsx` have
 * derived them client-side since 0.2.22.
 *
 * The list views also existed to WITHHOLD: a list renders one line per table, so
 * shipping every column object of every table was pure waste — 186 of them
 * across a 22-table corpus. That saving did not go away with them, it changed
 * owner: a list row asks for `select` with the columns it draws, and gets
 * exactly those.
 */
/** 0.2.24 — spread onto the type; the `serializer` wrapper is rejected now. */
export const databaseTableSerialization = {
  /** v1 files predate the reserved `title`; it starts life as a copy of `name`. */
  payloadUpgrades: databaseTablePayloadUpgrades,
} satisfies Pick<SerializationContribution<RawEntity>, 'payloadUpgrades' | 'diff'>;
