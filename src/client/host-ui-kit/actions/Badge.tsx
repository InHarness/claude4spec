import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `Badge` (Actions, `experimental`) — a non-interactive value marker (an enum
 * value, a count, a state), anatomy `value-badge`.
 *
 * Pure-presentational. 2.1.39 (record `badge`): the tag chip role moved to
 * `TagChip`, so `Badge` lost `color`, `active`, `onClick`, `onRemove` and
 * `dot` — it draws no dot, has no button role and is never a Tab stop. An
 * editable value is `EnumBadgePicker`, an action `ActionButton`.
 */
export interface BadgeProps {
  label: ReactNode;
  small?: boolean;
  /** Text color; defaults to `var(--c-ink)`. */
  foreground?: string;
  /** Render the label in monospace, bold, tracked-out type (e.g. status codes). */
  mono?: boolean;
  /** Minimum width in px, so badges with different label lengths (e.g. HTTP methods) align to a common column width in a list. Centers the label when set. */
  minWidth?: number;
  /**
   * `'broken'` marks a dangling reference — a slug whose target no longer
   * resolves. It reads as an error (red ink and hairline, ⚠ prefix — colour
   * alone is not enough for colour-blind readers) and wins over `foreground`.
   */
  variant?: 'default' | 'broken';
}

const RED = 'var(--c-red, #c45a3b)';

function BadgeImpl({ label, small, foreground, mono, minWidth, variant = 'default' }: BadgeProps) {
  const broken = variant === 'broken';
  return (
    <span
      className={`value-badge inline-flex items-center gap-1.5 rounded-full${mono ? ' font-mono font-semibold tracking-wide' : ''}${minWidth ? ' justify-center' : ''}`}
      style={{
        padding: small ? '1px 7px' : '2px 8px',
        fontSize: small ? 10.5 : 11.5,
        background: 'var(--c-panel)',
        color: broken ? RED : (foreground ?? 'var(--c-ink)'),
        border: `1px solid ${broken ? RED : 'var(--c-hair)'}`,
        minWidth,
      }}
    >
      {broken && <span aria-hidden>⚠</span>}
      {label}
    </span>
  );
}

export const Badge = withStability(BadgeImpl, 'experimental');
