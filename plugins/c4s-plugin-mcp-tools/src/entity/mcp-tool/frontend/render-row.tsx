/**
 * Render slot `renderRow` — a row of an EMBEDDED list inside page content or the
 * agent chat. This is the slot the `<tagged_list type="mcp-tool" tags="srv-…"/>`
 * directive draws through, which for this type is the primary way a tool is ever
 * seen: a server's page embeds its whole tool list rather than describing it.
 *
 * `renderRow` serves embedded lists ONLY. It is deliberately NOT what the
 * plugin's own list SCREEN renders — that composes the kit's `EntityListRow`
 * itself through `list-row.tsx`. Confusing the two is a mistake the spec calls
 * out by name, so they live in two files and `routes.tsx` never imports this one.
 *
 * PURE REACT: the host injects an already-resolved, non-null `entity`; the row
 * never fetches and owns no broken state (a broken slug inside an embedded list
 * is rendered by the host as a CHIP). Colours are `var(--c-*)` tokens only.
 */

import type { FC } from 'react';
import { EntityListRow } from '@c4s/plugin-runtime/ui';
import type { Tag } from '@c4s/plugin-runtime/ui';
import type { EntityRowProps } from '@c4s/plugin-runtime';
import { McpToolIcon } from './icon.js';
import { shapeSummary } from './summary.js';
import type { McpTool } from '../types.js';

/** Embedded rows carry no tag chips — the host embed passes no tag context. */
const EMPTY_TAG_LOOKUP = new Map<string, Tag>();

export const McpToolRow: FC<EntityRowProps<McpTool>> = ({ entity, active, onOpen }) => (
  <EntityListRow
    leading={<McpToolIcon size={16} style={{ color: 'var(--c-accent)' }} />}
    onClick={onOpen ?? (() => {})}
    style={active ? { background: 'var(--c-accent-soft)' } : undefined}
    tags={[]}
    tagLookup={EMPTY_TAG_LOOKUP}
    trailing={
      <span
        className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
        style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
      >
        {shapeSummary(entity)}
      </span>
    }
  >
    <div className="flex items-center gap-2">
      <span className="font-mono text-[13.5px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
        {entity.name}
      </span>
    </div>
    {/*
      The DESCRIPTION, not a field summary — this is the text that goes to the
      model, so a reader scanning an embedded tool list is reading the actual
      contract rather than a paraphrase of it.
    */}
    <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
      {entity.description}
    </div>
  </EntityListRow>
);
