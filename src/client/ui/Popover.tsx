import { forwardRef, useEffect, useState, type ReactNode } from 'react';
import { Popover } from '../host-ui-kit/overlay-feedback/Popover.js';
import { UI_EVENTS, type PopoverKind, type PopoverRequest, type PopoverResult } from './events.js';
import { POPOVER_RENDERERS } from './popovers/registry.js';

export interface PopoverShellProps {
  x: number;
  y: number;
  width?: number;
  onCancel: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}

/**
 * The host's popover FACADE (M34/L12 one-implementation rule): it renders the
 * catalog's `Popover` and maps the imperative `openPopover()` payload onto its
 * props. There is no host-internal popover anatomy any more — panel chrome,
 * header, click-outside, Escape and viewport clamping all live in the catalog
 * component. What stays here is the *invocation surface*: coordinates from an
 * event payload rather than props-in state.
 */
export function PopoverShell({
  x,
  y,
  width = 320,
  onCancel,
  title,
  icon,
  children,
}: PopoverShellProps) {
  return (
    <Popover open onClose={onCancel} at={{ x, y }} width={width} title={title} icon={icon}>
      {children}
    </Popover>
  );
}

export interface PopoverFormProps<K extends PopoverKind> {
  request: PopoverRequest<K>;
  onClose: (result: PopoverResult<K> | null) => void;
}

export function PopoverHost() {
  const [request, setRequest] = useState<PopoverRequest | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<PopoverRequest>;
      setRequest((prev) => {
        if (prev) prev.resolve(null);
        return ce.detail;
      });
    };
    window.addEventListener(UI_EVENTS.POPOVER, handler as EventListener);
    return () => window.removeEventListener(UI_EVENTS.POPOVER, handler as EventListener);
  }, []);

  if (!request) return null;

  const Renderer = POPOVER_RENDERERS[request.kind];
  if (!Renderer) {
    request.resolve(null);
    return null;
  }

  const handleClose = (result: unknown) => {
    const r = request;
    setRequest(null);
    r.resolve(result as never);
  };

  const Component = Renderer as (props: PopoverFormProps<PopoverKind>) => ReactNode;
  return <Component request={request} onClose={handleClose as PopoverFormProps<PopoverKind>['onClose']} />;
}

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
