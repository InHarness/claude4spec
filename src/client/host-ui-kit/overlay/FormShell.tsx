import type { FormEvent, ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `FormShell` (Overlay/Create, `experimental`) — a form container that composes
 * the existing `FormField` / `InlineEditField` atoms. The presentational
 * extraction of the `<form>` body shared by the host's create dialogs: fields,
 * a form-level error line, and a Save/Cancel actions row.
 *
 * Owns NO mutation. `onSubmit` is the plugin author's callback (the convention
 * `useCreate{Type}` lives there, not here); `busy` disables the fieldset while a
 * submit is in flight, `error` renders a message below the fields.
 */
export interface FormShellProps {
  /** Submit handler — the author's mutation lives here, not in the shell. */
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  /** Fields, typically `FormField` / `InlineEditField` atoms. */
  children: ReactNode;
  /** Save/Cancel slot, rendered as a right-aligned row below the error. */
  actions?: ReactNode;
  /** Disables the fields while a submit is in flight. */
  busy?: boolean;
  /** Form-level error message, rendered below the fields. */
  error?: ReactNode;
}

function FormShellImpl({ onSubmit, children, actions, busy, error }: FormShellProps) {
  return (
    <form onSubmit={onSubmit}>
      {/* `border: 0; padding: 0; margin: 0` keeps the native fieldset's default
          chrome out while still propagating `disabled` to every nested control. */}
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minInlineSize: 'auto' }}>
        <div className="space-y-3">{children}</div>
        {error != null && (
          <div
            className="text-[12px] px-2 py-1.5 rounded mt-3"
            style={{ background: 'var(--c-red-soft)', color: 'var(--c-red, #c45a3b)' }}
          >
            {error}
          </div>
        )}
        {actions != null && (
          <div className="flex items-center justify-end gap-2 mt-4">{actions}</div>
        )}
      </fieldset>
    </form>
  );
}

export const FormShell = withStability(FormShellImpl, 'experimental');
