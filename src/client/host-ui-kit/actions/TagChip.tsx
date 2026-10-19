import type { KeyboardEvent } from 'react';
import { withStability } from '../stability.js';

/**
 * `TagChip` (Actions, `experimental`) — the catalog's ONE tag chip (record
 * `tag-chip`, anatomy `tag-chip`, 2.1.39): a pill with a leading dot in the
 * tag's `color`, optionally clickable and removable. Split off `Badge`, which
 * keeps only the non-interactive value-marker role.
 *
 * Pure-presentational: label, color and handlers are props. A tag missing from
 * the caller's tag map renders its slug in the default colour — there is no
 * `broken` variant for tags.
 *
 * With an `onClick` the chip is a keyboard target — reachable with Tab
 * (`tabIndex=0`, `role="button"`) and activated by Enter or Space. Without
 * `onClick` it stays a plain, unfocusable span. A key pressed on the nested
 * remove button is that button's own, and its click never reaches `onClick`.
 */
export interface TagChipProps {
  label: string;
  /** Dot colour; with `active` also the fill and border. Defaults to a muted token. */
  color?: string;
  /** Filled style in `color`; dot and text turn `#fff`. */
  active?: boolean;
  small?: boolean;
  onClick?: () => void;
  /** Adds a "×" remove button (`aria-label="remove"`). */
  onRemove?: () => void;
}

function TagChipImpl({ label, color, active, small, onClick, onRemove }: TagChipProps) {
  const onKeyDown = onClick
    ? (e: KeyboardEvent<HTMLSpanElement>) => {
        // Only the chip itself: Enter/Space on the nested remove button belongs to it.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          onClick();
        }
      }
    : undefined;
  const dotColor = color ?? 'var(--c-muted)';
  const textColor = active ? '#fff' : 'var(--c-ink)';
  return (
    <span
      onClick={onClick}
      {...(onClick ? { role: 'button', tabIndex: 0, onKeyDown } : null)}
      className="tag-chip inline-flex items-center gap-1.5 rounded-full chip-hover transition"
      style={{
        padding: small ? '1px 7px' : '2px 8px',
        fontSize: small ? 10.5 : 11.5,
        background: active ? dotColor : 'var(--c-panel)',
        color: textColor,
        border: `1px solid ${active ? dotColor : 'var(--c-hair)'}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span
        className="rounded-full"
        style={{ width: 6, height: 6, background: active ? textColor : dotColor }}
      />
      {label}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="opacity-70 hover:opacity-100"
          style={{ marginLeft: 2 }}
          aria-label="remove"
        >
          ×
        </button>
      )}
    </span>
  );
}

export const TagChip = withStability(TagChipImpl, 'experimental');
