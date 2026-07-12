import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `Badge` (Actions, `experimental`) — a pill chip, typically a tag, with an
 * optional colored dot and remove affordance. Extracted from the host's
 * `TagChip`.
 *
 * Pure-presentational: label, color and handlers are props. The host's
 * data-resolving tag chips (M13/M19) stay separate — this is the styling shell.
 */
export interface BadgeProps {
  label: ReactNode;
  /** Dot / active color. Defaults to a muted token. */
  color?: string;
  /** Filled (active) style. */
  active?: boolean;
  small?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  /** Explicit text color; overrides the default active/inactive ink color. */
  foreground?: string;
  /** Render the label in monospace, bold, tracked-out type (e.g. status codes). */
  mono?: boolean;
  /** Show the leading color dot. Defaults to true. */
  dot?: boolean;
  /** Minimum width in px, so badges with different label lengths (e.g. HTTP methods) align to a common column width in a list. Centers the label when set. */
  minWidth?: number;
}

function BadgeImpl({
  label,
  color,
  active,
  small,
  onClick,
  onRemove,
  foreground,
  mono,
  dot = true,
  minWidth,
}: BadgeProps) {
  const dotColor = color ?? 'var(--c-muted)';
  const textColor = foreground ?? (active ? '#fff' : 'var(--c-ink)');
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full chip-hover transition${mono ? ' font-mono font-semibold tracking-wide' : ''}${minWidth ? ' justify-center' : ''}`}
      style={{
        padding: small ? '1px 7px' : '2px 8px',
        fontSize: small ? 10.5 : 11.5,
        background: active ? dotColor : 'var(--c-panel)',
        color: textColor,
        border: `1px solid ${active ? dotColor : 'var(--c-hair)'}`,
        cursor: onClick ? 'pointer' : 'default',
        minWidth,
      }}
    >
      {dot && <span className="rounded-full" style={{ width: 6, height: 6, background: active ? textColor : dotColor }} />}
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

export const Badge = withStability(BadgeImpl, 'experimental');
