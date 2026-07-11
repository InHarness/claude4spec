import type { CSSProperties, ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `ActionButton` (Actions, `experimental`) — a single action button in the host
 * style, in three variants. Extracted from the host's `ActionBar` button.
 *
 * Pure-presentational: label, icon, variant and handler are props.
 */
export type ActionButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ActionButtonProps {
  label: ReactNode;
  /** Omit when `type="submit"` and the enclosing form's `onSubmit` already handles the action — avoids double-firing on click. */
  onClick?: () => void;
  icon?: ReactNode;
  variant?: ActionButtonVariant;
  disabled?: boolean;
  /** Native tooltip — useful to explain a disabled state. */
  title?: string;
  /** Native button type. Defaults to `button`; set `submit` to make this the form's default action (e.g. Enter-to-submit) inside a `FormShell`. */
  type?: 'button' | 'submit';
}

const VARIANT_STYLE: Record<ActionButtonVariant, CSSProperties> = {
  primary: { background: 'var(--c-accent)', color: '#fff', border: '1px solid transparent' },
  secondary: {
    background: 'var(--c-panel)',
    color: 'var(--c-ink)',
    border: '1px solid var(--c-hair)',
  },
  ghost: { background: 'transparent', color: 'var(--c-muted)', border: '1px solid transparent' },
};

function ActionButtonImpl({
  label,
  onClick,
  icon,
  variant = 'secondary',
  disabled = false,
  title,
  type = 'button',
}: ActionButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium"
      style={{
        ...VARIANT_STYLE[variant],
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export const ActionButton = withStability(ActionButtonImpl, 'experimental');
