/**
 * The popover FORM primitives, copied from the host's `ui/Popover.tsx`.
 *
 * Only the field/footer helpers travel: the host file also owns the popover
 * HOST (the singleton that renders whichever popover the event bus requested)
 * and imports the host's popover registry, neither of which a plugin can or
 * should reach. These are pure presentational leaves, so copying them is
 * cheaper than growing the published UI kit for two consumers.
 *
 * `PopoverShell` is deliberately absent — a plugin popover is rendered by the
 * host's own shell around the component this package registers.
 */

import { forwardRef, type ReactNode } from 'react';

// ---------- Shared field primitives for popover forms ----------

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="text-[10.5px] uppercase tracking-wider font-mono mb-1"
      style={{ color: 'var(--c-subtle)' }}
    >
      {children}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ style, className, ...rest }, ref) {
    return (
      <input
        {...rest}
        ref={ref}
        spellCheck={false}
        className={`w-full text-[13.5px] bg-transparent outline-none px-2 py-1 rounded ${className ?? ''}`}
        style={{
          color: 'var(--c-ink)',
          border: '1px solid var(--c-hair)',
          ...style,
        }}
      />
    );
  },
);

export const SelectInput = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }
>(function SelectInput({ style, className, children, ...rest }, ref) {
  return (
    <select
      {...rest}
      ref={ref}
      className={`w-full text-[13px] bg-transparent outline-none px-2 py-1 rounded ${className ?? ''}`}
      style={{
        color: 'var(--c-ink)',
        border: '1px solid var(--c-hair)',
        ...style,
      }}
    >
      {children}
    </select>
  );
});

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="text-[11.5px] mt-1" style={{ color: 'var(--c-red, #c45a3b)' }}>
      {message}
    </div>
  );
}

export function PopoverFooter({
  onCancel,
  onSubmit,
  submitLabel = 'Create',
  busy = false,
  disabled = false,
  onRemove,
  removeLabel = 'Remove',
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2 justify-end mt-3">
      {onRemove && (
        <button
          onClick={onRemove}
          className="text-[12px] px-2 py-1 rounded mr-auto"
          style={{ color: 'var(--c-red, #c45a3b)' }}
        >
          {removeLabel}
        </button>
      )}
      <button
        onClick={onCancel}
        className="text-[12px] px-2 py-1 rounded"
        style={{ color: 'var(--c-muted)' }}
      >
        Cancel
      </button>
      <button
        onClick={onSubmit}
        disabled={busy || disabled}
        className="text-[12px] px-3 py-1 rounded font-medium"
        style={{
          background: 'var(--c-accent)',
          color: '#fff',
          opacity: busy || disabled ? 0.55 : 1,
        }}
      >
        {busy ? '…' : submitLabel}
      </button>
    </div>
  );
}
