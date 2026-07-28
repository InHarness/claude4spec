import type { ReactNode } from 'react';
import { withStability } from '../stability.js';
import { ActionButton, type ActionButtonVariant } from './ActionButton.js';

/**
 * `ActionBar` (Akcje, `experimental`) — a sticky bottom action bar for a view: a
 * container pinned to the bottom of a list or page holding 1..N actions that
 * act on the whole view, plus optional left-side status text. Not floating, no
 * scrim — it sits *below* the interaction primitives (Toast 1300, Dialog 1200,
 * Popover 1100) at zIndex 900.
 *
 * Promoted out of L5-B into the catalog in 0.1.144: it has more than one
 * consumer (the `ac` list and M10's plan footer), so the host-local gate —
 * which requires a single use site — does not admit it. The buttons delegate to
 * `ActionButton`; this owns only the sticky-bar layout and the status slot.
 */

export type ActionBarVariant = ActionButtonVariant;

export interface ActionBarAction {
  /** Stable React key; defaults to the label. */
  key?: string;
  label: string;
  icon?: ReactNode;
  onClick(): void;
  variant?: ActionBarVariant;
  disabled?: boolean;
  /** Native tooltip — useful to explain a disabled state. */
  title?: string;
}

export interface ActionBarProps {
  /** Optional left-aligned status text. */
  status?: ReactNode;
  /** Right-aligned action buttons. */
  actions: ActionBarAction[];
}

function ActionBarImpl({ status, actions }: ActionBarProps) {
  return (
    <div
      className="flex items-center gap-3"
      style={{
        position: 'sticky',
        bottom: 0,
        width: '100%',
        zIndex: 900,
        background: 'var(--c-card)',
        borderTop: '1px solid var(--c-hair)',
        padding: '12px 16px',
      }}
    >
      {status != null && (
        <span className="text-[12px] truncate" style={{ color: 'var(--c-subtle)' }}>
          {status}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {actions.map((action) => (
          <ActionButton
            key={action.key ?? action.label}
            label={action.label}
            icon={action.icon}
            onClick={action.onClick}
            variant={action.variant ?? 'secondary'}
            disabled={action.disabled}
            title={action.title}
          />
        ))}
      </div>
    </div>
  );
}

export const ActionBar = withStability(ActionBarImpl, 'experimental');
