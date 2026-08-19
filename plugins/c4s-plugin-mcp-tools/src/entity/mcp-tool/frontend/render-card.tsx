/**
 * Render slot `renderCard` — the `<single_element type="mcp-tool"/>` embed.
 *
 * Purely presentational; the host injects an already-resolved entity and the card
 * never fetches. It owns a "broken" branch because `EntityCardProps<T> extends
 * EntityChipProps<T>` — `entity` really is `T | null`, and a dangling embed
 * reaches this component with `null`.
 *
 * VISUAL CONTRACT — the host's own card, byte-for-byte: a `--c-card` surface
 * inside a `--c-hair` hairline, `rounded-md p-3`, a title row of accent icon +
 * 600-weight name + spacer + chevron, a muted second line, then the field list.
 * Hover moves the border to `--c-accent` (cards go to the accent; only CHIPS
 * hover to `--c-hair-strong`).
 *
 * WHAT THE CARD SHOWS is the CONTRACT and only the contract: description,
 * parameters, and the declared hints. `logic` is deliberately absent — it is not
 * sent to the model and is material for whoever codes the tool, so putting it on
 * an embed that appears mid-prose would put implementation notes in front of
 * every reader of the page. The detail panel is where it lives, below a visible
 * separation.
 *
 * The parameter list is capped with a `… +N more` tail: the editor's content
 * column leaves a card roughly 628px wide, so an uncapped 20-parameter tool would
 * swallow the page it is embedded in.
 *
 * Tailwind classes are copied verbatim from the host — `tailwind.config.js` scans
 * only `./src/client/**`, so a utility the host does not itself write is absent
 * from the served CSS. Colours are bare `var(--c-*)`, never a literal.
 */

import type { FC } from 'react';
import { editorBridge } from '@c4s/plugin-runtime';
import type { EntityCardProps } from '@c4s/plugin-runtime';
import { MCP_TOOL_TYPE } from '../../../identity.js';
import type { McpTool } from '../types.js';
import { McpToolIcon } from './icon.js';
import { declaredHints, shapeSummary } from './summary.js';

/** How many parameters the card lists before collapsing the rest into `… +N more`. */
const MAX_VISIBLE_PARAMS = 6;

export const McpToolCard: FC<EntityCardProps<McpTool>> = ({ slug, entity, onOpen }) => {
  const open = () => (onOpen ? onOpen() : editorBridge.openEntity(MCP_TOOL_TYPE, slug));

  if (!entity) {
    return (
      <button
        type="button"
        onClick={open}
        className="block w-full text-left rounded-md p-3 font-mono text-[12px]"
        style={{
          background: 'var(--c-red-soft)',
          color: 'var(--c-red)',
          border: '1px solid var(--c-red)',
        }}
      >
        ⚠ broken reference: mcp-tool '{slug}'
      </button>
    );
  }

  const params = entity.params ?? [];
  const visible = params.slice(0, MAX_VISIBLE_PARAMS);
  const hidden = params.length - visible.length;
  const hints = declaredHints(entity);

  return (
    <button
      type="button"
      onClick={open}
      className="block w-full text-left rounded-md p-3 transition"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-hair)';
      }}
    >
      <div className="flex items-center gap-2">
        <McpToolIcon size={15} style={{ color: 'var(--c-accent)' }} />
        <span className="font-mono text-[13.5px]" style={{ color: 'var(--c-ink)', fontWeight: 600 }}>
          {entity.name}
        </span>
        <span className="text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
          {entity.server}
        </span>
        <span className="flex-1" />
        <span style={{ color: 'var(--c-muted)' }}>›</span>
      </div>

      <div className="text-[12.5px] mt-1" style={{ color: 'var(--c-muted)' }}>
        {entity.description}
      </div>

      {params.length === 0 ? (
        <div className="text-[11.5px] mt-2" style={{ color: 'var(--c-muted)' }}>
          {shapeSummary(entity)}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-0.5">
          {visible.map((p) => (
            <div key={p.name} className="flex items-baseline gap-2 text-[11.5px] font-mono">
              <span style={{ color: 'var(--c-ink)' }}>{p.name}</span>
              <span style={{ color: 'var(--c-muted)' }}>{p.type}</span>
              {p.required ? <span style={{ color: 'var(--c-accent)' }}>required</span> : null}
            </div>
          ))}
          {hidden > 0 ? (
            <div className="text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
              … +{hidden} more
            </div>
          ) : null}
        </div>
      )}

      {/*
        Only DECLARED hints appear. An undeclared one is not drawn as a negative
        badge, because "the server says nothing" is not "the server says no" —
        and a card is exactly where that difference would be lost first.
      */}
      {hints.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {hints.map((h) => (
            <span
              key={h.label}
              className="text-[10.5px] px-1.5 py-0.5 rounded"
              style={{
                background: 'var(--c-panel)',
                color: h.value ? 'var(--c-ink)' : 'var(--c-muted)',
              }}
            >
              {h.value ? h.label : `not ${h.label.toLowerCase()}`}
            </span>
          ))}
        </div>
      ) : null}
    </button>
  );
};
