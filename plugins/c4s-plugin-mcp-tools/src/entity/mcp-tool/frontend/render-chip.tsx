/**
 * Render slot `renderChip` — the inline-mention embed of an `mcp-tool`.
 *
 * Takes `entity: McpTool | null` and therefore owns a "broken" branch: a
 * reference whose target was deleted, or whose type is not active in
 * `config.entities`. Only `renderRow` is guaranteed a resolved entity.
 *
 * Purely presentational — the host injects the already-resolved entity and the
 * chip never fetches. It must also survive the host's registration smoke test,
 * which renders it with `entity: null` OUTSIDE any provider, so no hooks here.
 *
 * VISUAL CONTRACT — the host's own chip, byte-for-byte, shared by every entity
 * type: a compact pill on `--c-card` inside a `--c-hair` hairline, 12px, the type
 * icon in `--c-accent`, `align-middle` so it sits on the text baseline, and a
 * hover moving the border to `--c-hair-strong` (chips go to the hairline — only
 * CARDS hover to the accent). Broken is a filled `--c-red-soft` pill.
 *
 * The label is the WIRE IDENTIFIER `{server} · {name}`, read off `title`, which
 * the schema derives to exactly that. Mono, because it is an identifier a reader
 * will compare against `mcp__{server}__{name}` in code.
 *
 * Tailwind classes are copied verbatim from the host: `tailwind.config.js` scans
 * only `./src/client/**`, so a utility the host does not write is physically
 * absent from the served CSS. Colours are bare `var(--c-*)` — never a literal.
 */

import type { FC } from 'react';
import { editorBridge } from '@c4s/plugin-runtime';
import type { EntityChipProps } from '@c4s/plugin-runtime';
import { MCP_TOOL_TYPE } from '../../../identity.js';
import type { McpTool } from '../types.js';
import { McpToolIcon } from './icon.js';

export const McpToolChip: FC<EntityChipProps<McpTool>> = ({ slug, entity, onOpen }) => {
  const open = () => (onOpen ? onOpen() : editorBridge.openEntity(MCP_TOOL_TYPE, slug));

  if (!entity) {
    return (
      <button
        type="button"
        onClick={open}
        title={`broken reference: mcp-tool '${slug}'`}
        className="c4s-chip c4s-chip--broken inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] text-[11px] font-mono"
        style={{
          background: 'var(--c-red-soft)',
          color: 'var(--c-red)',
          border: '1px solid var(--c-red)',
        }}
      >
        ⚠ {slug}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      className="c4s-chip inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] font-mono transition"
      style={{
        border: '1px solid var(--c-hair)',
        background: 'var(--c-card)',
        fontSize: 12,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-hair-strong)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-hair)';
      }}
    >
      <McpToolIcon size={11} style={{ color: 'var(--c-accent)' }} />
      <span style={{ color: 'var(--c-ink)' }}>{entity.title}</span>
    </button>
  );
};
