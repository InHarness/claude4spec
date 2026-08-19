/**
 * The LIST SCREEN's row — the kit's `EntityListRow`, distinct from the
 * `renderRow` slot, which serves embedded lists only (see `render-row.tsx`). The
 * two rows are two files on purpose: this one draws tag chips, which an embedded
 * row has no tag context for.
 *
 * Purely presentational — item, tags and lookup come from the screen's hooks.
 * Row style discipline: colours are `var(--c-*)` tokens only, and the row icon
 * uses `var(--c-subtle)` rather than the accent.
 *
 * The row leads with `name`, not `title`. Under the default grouping the server
 * is already the section heading, so repeating it on every row would be noise;
 * `title` (which IS `{server} · {name}`) stays the label everywhere the grouping
 * is absent — chips, cards, breadcrumbs.
 */

import type { FC } from 'react';
import { EntityListRow } from '@c4s/plugin-runtime/ui';
import type { Tag } from '@c4s/plugin-runtime/ui';
import { McpToolIcon } from './icon.js';
import { shapeSummary } from './summary.js';
import type { McpTool } from '../types.js';

const EMPTY_TAG_LOOKUP = new Map<string, Tag>();

export interface McpToolListRowProps {
  item: McpTool;
  /** Tag slugs of this item (host-owned data). */
  tags?: string[];
  /** slug → Tag, derived once by the screen from the host tag catalog. */
  tagLookup?: Map<string, Tag>;
  /**
   * Whether to show the server beside the name. False under the default
   * grouping, where the section heading already says it; true in flat mode,
   * where a bare tool name is ambiguous across servers.
   */
  showServer?: boolean;
  onOpen: () => void;
}

export const McpToolListRow: FC<McpToolListRowProps> = ({
  item,
  tags,
  tagLookup,
  showServer,
  onOpen,
}) => (
  <EntityListRow
    leading={<McpToolIcon size={16} style={{ color: 'var(--c-subtle)' }} />}
    onClick={onOpen}
    tags={tags ?? []}
    tagLookup={tagLookup ?? EMPTY_TAG_LOOKUP}
    trailing={
      <span
        className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
        style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
      >
        {shapeSummary(item)}
      </span>
    }
  >
    <div className="flex items-center gap-2">
      <span className="font-mono text-[13.5px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
        {item.name}
      </span>
      {showServer ? (
        <span className="text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
          {item.server}
        </span>
      ) : null}
    </div>
    <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
      {item.description}
    </div>
  </EntityListRow>
);
