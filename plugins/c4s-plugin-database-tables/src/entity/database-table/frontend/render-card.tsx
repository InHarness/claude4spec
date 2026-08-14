/**
 * Render slot `renderCard` — the `single_element` embed of a `database-table`.
 *
 * Purely presentational; the host injects an already-resolved entity through the
 * module's `useGetBySlug`, and the card never fetches.
 *
 * The card owns a "broken" branch. `EntityCardProps<T> extends EntityChipProps<T>`
 * (`claude4spec/src/plugin-types/plugin-runtime.ts:227-245`,
 * `src/client/entities/registry.tsx:19`), so `entity` really is `T | null` and a
 * dangling `<single_element/>` reaches this component with `null` — previously it
 * blew up on `entity.name`. This plugin's own spec claims otherwise
 * (`ac-renderchip-jest-jedynym-render-slotem-ob`, "renderChip is the ONLY slot
 * handling broken"); that claim is wrong for the card and has been routed to the
 * spec author (`c4s ask` thread `13QZu_Wx6GRL`). The host contract wins.
 *
 * VISUAL CONTRACT — the host's own card, byte-for-byte, from
 * `claude4spec/src/client/entities/dto/plugin.tsx:99-152` (all five native entity
 * types share the recipe; `plugins-doc` `widoki-osadzane.md` anchor `n8bokjeb`
 * repeats it): a `--c-card` surface inside a `--c-hair` hairline, `rounded-md p-3`,
 * a title row of accent icon + 600-weight name + spacer + chevron, a muted second
 * line, and then the FIELD LIST — for a table, its columns. Hover moves the border
 * to `--c-accent` (cards go to the accent; only CHIPS hover to `--c-hair-strong`).
 *
 * The column list is capped at `MAX_VISIBLE_COLUMNS` with a `… +N more` tail, the
 * same way the host caps a DTO's fields: the editor's content column leaves a card
 * roughly 628px wide (`claude4spec/src/client/components/Editor.tsx:200-237`), so an
 * uncapped 30-column table would swallow the page it is embedded in.
 *
 * Tailwind classes are copied verbatim from the host — `tailwind.config.js` scans
 * only `./src/client/**`, so a utility the host does not itself write is absent from
 * the served CSS. Colours are bare `var(--c-*)`, never a literal and never a
 * `var(--x, #fallback)` (which would pin a light-mode colour in dark mode).
 */

import type { FC } from 'react';
import { editorBridge } from '@c4s/plugin-runtime';
import type { EntityCardProps } from '@c4s/plugin-runtime';
import { DATABASE_TABLE_TYPE } from '../../../identity.js';
import type { Column, DatabaseTable } from '../types.js';
import { DatabaseTableIcon } from './icon.js';

/** How many columns the card lists before collapsing the rest into `… +N more`. */
const MAX_VISIBLE_COLUMNS = 6;

/**
 * The two shapes a render slot can be handed, reconciled.
 *
 * A LIST view (`element_list_item` / `tagged_list_item`, and `listByTags`)
 * carries `columnCount` / `indexCount` and no arrays at all — sending 186
 * column objects to a screen that draws one line each is pure waste.
 * `single_element` carries the arrays. A slot that reads only the arrays
 * therefore renders "0 columns · 0 indexes" for every row of a
 * `<tagged_list/>`, which is what this reconciliation exists to prevent.
 */
export function countsOf(entity: {
  columns?: unknown[];
  indexes?: unknown[];
  columnCount?: number;
  indexCount?: number;
}): { columns: number; indexes: number } {
  return {
    columns: entity.columnCount ?? entity.columns?.length ?? 0,
    indexes: entity.indexCount ?? entity.indexes?.length ?? 0,
  };
}

/** "3 columns · 1 index" — the shape summary shared by the card and the embedded row. */
export function shapeSummary(counts: { columns?: number; indexes?: number }): string {
  const columns = counts.columns ?? 0;
  const indexes = counts.indexes ?? 0;
  return `${columns} column${columns === 1 ? '' : 's'} · ${indexes} index${indexes === 1 ? '' : 'es'}`;
}

/**
 * The "open me" affordance in the title row. Inline SVG rather than lucide's
 * `ChevronRight`: `lucide-react` is neither a dependency of this plugin nor
 * externalized in `vite.config.ts`, so importing it would bundle a copy (or fail to
 * resolve). Same reasoning as `icon.tsx`.
 */
const ChevronRightGlyph: FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 3.5L10.5 8L6 12.5" />
  </svg>
);

/**
 * The flags a single column carries, in the order the host reads a field: identity
 * first (`pk`), then constraints. Rendered as `--c-panel` pills, like the host's
 * `req` marker on a DTO field.
 */
function columnFlags(column: Column): string[] {
  const flags: string[] = [];
  if (column.pk) flags.push('pk');
  if (column.unique) flags.push('uniq');
  if (column.fk) flags.push('fk');
  return flags;
}

export const DatabaseTableCard: FC<EntityCardProps<DatabaseTable>> = ({ slug, entity, onOpen }) => {
  const open = () => (onOpen ? onOpen() : editorBridge.openEntity(DATABASE_TABLE_TYPE, slug));

  // Broken reference — the block-level counterpart of the chip's red pill.
  if (!entity) {
    return (
      <div
        className="c4s-card c4s-card--broken rounded-md p-3"
        title={`broken reference: database-table '${slug}'`}
        style={{
          background: 'var(--c-red-soft)',
          border: '1px dashed var(--c-red)',
          color: 'var(--c-red)',
        }}
      >
        <div className="text-[12px] font-mono">⚠ broken: database-table "{slug}"</div>
      </div>
    );
  }

  const columns = entity.columns ?? [];
  const visible = columns.slice(0, MAX_VISIBLE_COLUMNS);
  const hidden = columns.length - visible.length;

  return (
    <button
      type="button"
      onClick={open}
      className="c4s-card w-full text-left rounded-md p-3 transition"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-hair)';
      }}
    >
      <div className="flex items-center gap-2">
        <DatabaseTableIcon size={14} style={{ color: 'var(--c-accent)' }} />
        <span className="c4s-card__title text-[15px]" style={{ color: 'var(--c-ink)', fontWeight: 600 }}>
          {entity.title}
        </span>
        <span className="flex-1" />
        <ChevronRightGlyph size={14} />
      </div>

      <div className="c4s-card__shape mt-1.5 text-[12.5px]" style={{ color: 'var(--c-muted)' }}>
        {shapeSummary(countsOf(entity))}
      </div>

      {entity.description ? (
        <div className="mt-1 text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
          {entity.description}
        </div>
      ) : null}

      {visible.length > 0 ? (
        <ul className="mt-3 space-y-0.5">
          {visible.map((column) => (
            <li
              key={column.name}
              className="font-mono text-[12px] flex items-center gap-1.5"
              style={{ color: 'var(--c-muted)' }}
            >
              <span style={{ color: 'var(--c-ink)' }}>{column.name}</span>
              <span style={{ color: 'var(--c-subtle)' }}>:</span>
              <span>{column.type}</span>
              {columnFlags(column).map((flag) => (
                <span
                  key={flag}
                  className="text-[10px] px-1 rounded"
                  style={{ background: 'var(--c-panel)', color: 'var(--c-accent-ink)' }}
                >
                  {flag}
                </span>
              ))}
            </li>
          ))}
          {hidden > 0 ? (
            <li className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
              … +{hidden} more
            </li>
          ) : null}
        </ul>
      ) : null}
    </button>
  );
};
