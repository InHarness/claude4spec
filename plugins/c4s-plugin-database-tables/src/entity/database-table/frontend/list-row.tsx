/**
 * The LIST SCREEN's row — the Host UI Kit's `EntityListRow`, fed the lightweight
 * `DatabaseTableListItem` projection.
 *
 * The spec calls out the common mistake explicitly: list-screen rows are rendered
 * by `EntityListRow` from the kit, NOT by the `renderRow` slot — `renderRow` is
 * for embedded lists in content only (see `render-row.tsx`). The two rows are two
 * files on purpose: this one consumes `columnCount`/`indexCount` (the list DTO
 * never carries `columns[]`/`indexes[]`) and draws tag chips, which an embedded
 * row has no tag context for.
 *
 * Purely presentational — data (item, tags, tag lookup) comes from the screen's
 * hooks. Row style discipline: colours are `var(--c-*)` tokens only, never
 * literals, and the row icon uses `var(--c-subtle)` rather than the accent.
 */

import type { FC } from 'react';
import { EntityListRow } from '@c4s/plugin-runtime/ui';
import type { Tag } from '@c4s/plugin-runtime/ui';
import { DatabaseTableIcon } from './icon.js';
import { shapeSummary } from './render-card.js';
import type { DatabaseTableListItem } from '../types.js';

const EMPTY_TAG_LOOKUP = new Map<string, Tag>();

export interface DatabaseTableListRowProps {
  item: DatabaseTableListItem;
  /** Tag slugs of this item (host-owned data, carried on the list projection). */
  tags?: string[];
  /** slug → Tag, derived once by the screen from the host tag catalog. */
  tagLookup?: Map<string, Tag>;
  onOpen: () => void;
}

export const DatabaseTableListRow: FC<DatabaseTableListRowProps> = ({
  item,
  tags,
  tagLookup,
  onOpen,
}) => (
  <EntityListRow
    // Row icon is `--c-subtle`, not the accent (row style discipline).
    leading={<DatabaseTableIcon size={16} style={{ color: 'var(--c-subtle)' }} />}
    onClick={onOpen}
    tags={tags ?? []}
    tagLookup={tagLookup ?? EMPTY_TAG_LOOKUP}
    trailing={
      <span
        className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
        style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
      >
        {item.slug}
      </span>
    }
  >
    <div className="flex items-center gap-2">
      <span className="text-[14px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
        {item.name}
      </span>
    </div>
    <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
      {shapeSummary({ columns: item.columnCount, indexes: item.indexCount })}
    </div>
  </EntityListRow>
);
