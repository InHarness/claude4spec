import type { ReactNode } from 'react';
import { ActionButton, type ActionButtonVariant } from '../host-ui-kit/actions/ActionButton.js';

/**
 * L5-B layout primitive (brief 0.1.45 §2). A sticky bottom action bar for a
 * view: a persistent container pinned to the bottom of a list/page holding
 * 1..N action buttons that act on the whole view, plus optional left-side
 * status text. Not floating, no scrim — it sits *below* the interaction
 * primitives (Toast 1300, ConfirmModal 1200, Popover 1100) at zIndex 900.
 *
 * The buttons delegate to the Host UI Kit's `ActionButton` (M34/L12,
 * `experimental`); this owns only the sticky-bar layout + status slot.
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

export function ActionBar({ status, actions }: ActionBarProps) {
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
