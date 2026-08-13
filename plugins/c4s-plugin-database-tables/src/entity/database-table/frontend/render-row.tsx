/**
 * Render slot `renderRow` — a row of an EMBEDDED list (`element_list_item` /
 * `tagged_list_item`) inside page content or the agent chat.
 *
 * `renderRow` serves embedded lists ONLY. It is deliberately NOT what the plugin's
 * own list SCREEN renders — that screen composes the Host UI Kit's `EntityListRow`
 * itself, through `list-row.tsx` (`ac-renderchip-jest-jedynym-render-slotem-ob`,
 * second clause). Confusing the two is the mistake the spec calls out by name, so
 * the two rows live in two files and `routes.tsx` never imports this one.
 *
 * PURE REACT: the host injects the already-resolved, non-null `entity`; the row
 * never self-fetches and never owns a broken state (the chip and the card do — a
 * broken slug inside an embedded list is rendered by the host as a CHIP, never as a
 * row). Colours are `var(--c-*)` tokens only, never literals.
 *
 * `active` marks the row the surrounding view considers current, and the host's own
 * rows answer it with an `--c-accent-soft` fill (`plugins-doc` `widoki-osadzane.md`
 * anchor `x5lrvqpy`; `claude4spec/src/client/entities/dto/plugin.tsx:17-47`). The
 * kit's `EntityListRow` has no `active` prop, but it spreads a caller `style` OVER
 * its own defaults, so the fill goes in there — resting state stays the kit's
 * `--c-card`.
 */

import type { FC } from 'react';
import { EntityListRow } from '@c4s/plugin-runtime/ui';
import type { Tag } from '@c4s/plugin-runtime/ui';
import type { EntityRowProps } from '@c4s/plugin-runtime';
import { DatabaseTableIcon } from './icon.js';
import { countsOf, shapeSummary } from './render-card.js';
import type { DatabaseTable } from '../types.js';

/** Embedded rows carry no tag chips — the host embed passes no tag context. */
const EMPTY_TAG_LOOKUP = new Map<string, Tag>();

export const DatabaseTableRow: FC<EntityRowProps<DatabaseTable>> = ({ entity, active, onOpen }) => (
  <EntityListRow
    // Same shared icon reference as the sidebar tab and the list header.
    leading={<DatabaseTableIcon size={16} style={{ color: 'var(--c-accent)' }} />}
    onClick={onOpen ?? (() => {})}
    style={active ? { background: 'var(--c-accent-soft)' } : undefined}
    tags={[]}
    tagLookup={EMPTY_TAG_LOOKUP}
    // Paper-scale slug badge — 10.5px `font-mono`, panel/muted tokens.
    trailing={
      <span
        className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
        style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
      >
        {entity.slug}
      </span>
    }
  >
    <div className="flex items-center gap-2">
      <span className="text-[14px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
        {entity.title ?? entity.slug}
      </span>
    </div>
    <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
      {shapeSummary(countsOf(entity))}
    </div>
  </EntityListRow>
);
