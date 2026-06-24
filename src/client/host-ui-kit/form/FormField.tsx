import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `FormField` (Form, `experimental`) — a labelled form field with an optional
 * inline error. Wraps an arbitrary control (input/select/textarea) supplied as
 * children. Label/error styling extracted from the host's popover form
 * primitives (`FieldLabel` / `InlineError`).
 *
 * Pure-presentational: the control is passed in; this owns only label + error.
 */
export interface FormFieldProps {
  label: ReactNode;
  /** Inline error message; renders below the control when set. */
  error?: string | null;
  children: ReactNode;
}

function FormFieldImpl({ label, error, children }: FormFieldProps) {
  return (
    <div>
      <div
        className="text-[10.5px] uppercase tracking-wider font-mono mb-1"
        style={{ color: 'var(--c-subtle)' }}
      >
        {label}
      </div>
      {children}
      {error && (
        <div className="text-[11.5px] mt-1" style={{ color: 'var(--c-red, #c45a3b)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

export const FormField = withStability(FormFieldImpl, 'experimental');
