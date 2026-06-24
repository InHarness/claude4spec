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
}

function BadgeImpl({ label, color, active, small, onClick, onRemove }: BadgeProps) {
  const dot = color ?? 'var(--c-muted)';
  return (
    <span
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full chip-hover transition"
      style={{
        padding: small ? '1px 7px' : '2px 8px',
        fontSize: small ? 10.5 : 11.5,
        background: active ? dot : 'var(--c-panel)',
        color: active ? '#fff' : 'var(--c-ink)',
        border: `1px solid ${active ? dot : 'var(--c-hair)'}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span className="rounded-full" style={{ width: 6, height: 6, background: active ? '#fff' : dot }} />
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
