import type { CSSProperties, ReactNode } from 'react';

/**
 * L5-B layout primitive (brief 0.1.45 §2). A sticky bottom action bar for a
 * view: a persistent container pinned to the bottom of a list/page holding
 * 1..N action buttons that act on the whole view, plus optional left-side
 * status text. Not floating, no scrim — it sits *below* the interaction
 * primitives (Toast 1300, ConfirmModal 1200, Popover 1100) at zIndex 900.
 */

export type ActionBarVariant = 'primary' | 'secondary' | 'ghost';

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

const VARIANT_STYLE: Record<ActionBarVariant, CSSProperties> = {
  primary: { background: 'var(--c-accent)', color: '#fff', border: '1px solid transparent' },
  secondary: {
    background: 'var(--c-panel)',
    color: 'var(--c-ink)',
    border: '1px solid var(--c-hair)',
  },
  ghost: { background: 'transparent', color: 'var(--c-muted)', border: '1px solid transparent' },
};

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
        {actions.map((action) => {
          const variant = action.variant ?? 'secondary';
          return (
            <button
              key={action.key ?? action.label}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              title={action.title}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium"
              style={{
                ...VARIANT_STYLE[variant],
                opacity: action.disabled ? 0.4 : 1,
                cursor: action.disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
