import { useEffect, useState, type ReactNode } from 'react';
import { DirectoryPickerModal } from '../../host-ui-kit/overlay/DirectoryPickerModal.js';
import { parseLines, type ElementContext, type SettingsElementDecl } from './registry.js';

/**
 * 0.2.113 — the controls the registry generates from a declaration alone:
 * `toggle | text | textarea | lines | select | multiselect | path`. Every one of
 * them reads and writes through the card's draft, so nothing here saves — the
 * card's [Save] does.
 */
export function GeneratedElement({ decl, config, draft }: ElementContext & { decl: SettingsElementDecl }) {
  const key = decl.configKey;
  if (!key) return null;
  const value = draft.get(key);
  const set = (v: unknown) => draft.set(key, decl.emptyAsNull && v === '' ? null : v);
  const live = decl.validate?.(value, { config, draft }) ?? null;
  const error = draft.error(key) ?? live?.error ?? null;
  const disabled = draft.saving;

  if (decl.kind === 'toggle') {
    return (
      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => set(e.target.checked)}
            disabled={disabled}
            className="mt-0.5 h-4 w-4"
          />
          <span className="flex-1">
            <span className="block text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
              {decl.label}
            </span>
            {decl.help ? (
              <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--c-subtle)' }}>
                {decl.help}
              </span>
            ) : null}
          </span>
        </label>
        <Feedback error={error} warning={live?.warning} />
      </div>
    );
  }

  return (
    <ElementField
      label={decl.label}
      help={decl.help}
      error={error}
      warning={live?.warning}
      // A multiselect is a list of labelled checkboxes — never nested in one label.
      asLabel={decl.kind !== 'multiselect'}
    >
      <Control decl={decl} value={value} set={set} disabled={disabled} config={config} draft={draft} />
    </ElementField>
  );
}

function Control({
  decl,
  value,
  set,
  disabled,
}: ElementContext & {
  decl: SettingsElementDecl;
  value: unknown;
  set: (v: unknown) => void;
  disabled: boolean;
}) {
  const options = decl.useOptions?.();
  switch (decl.kind) {
    case 'text':
      return (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => set(e.target.value)}
            disabled={disabled}
            placeholder={decl.placeholder}
            className="flex-1 rounded-md px-3 py-1.5 text-[13px]"
            style={inputStyle}
          />
          <Counter value={value} max={decl.maxLength} />
        </div>
      );
    case 'textarea':
      return (
        <div className="flex flex-col gap-1">
          <textarea
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => set(e.target.value)}
            disabled={disabled}
            placeholder={decl.placeholder}
            rows={2}
            className="w-full rounded-md px-3 py-2 text-[13px] resize-y"
            style={inputStyle}
          />
          <div className="flex justify-end">
            <Counter value={value} max={decl.maxLength} />
          </div>
        </div>
      );
    case 'lines':
      return <LinesControl value={value} set={set} disabled={disabled} placeholder={decl.placeholder} />;
    case 'select':
      return (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value === '' && decl.nullOption !== undefined ? null : e.target.value)}
          disabled={disabled}
          className="w-full rounded-md px-3 py-1.5 text-[13px]"
          style={inputStyle}
        >
          {decl.nullOption !== undefined ? <option value="">{decl.nullOption}</option> : null}
          {(options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'multiselect': {
      const selected = new Set(
        Array.isArray(value)
          ? (value as string[])
          : decl.allWhenAbsent && value === undefined
            ? (options ?? []).map((o) => o.value)
            : [],
      );
      return (
        <div className="flex flex-col gap-1.5">
          {(options ?? []).map((o) => (
            <label
              key={o.value}
              className="flex items-center gap-3 rounded-md px-3 py-2"
              style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)' }}
            >
              <input
                type="checkbox"
                checked={selected.has(o.value)}
                disabled={disabled}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(o.value);
                  else next.delete(o.value);
                  // Keep the options' order, not the click order. A saved value no option
                  // offers (an entity type whose plugin is not installed yet) has no
                  // checkbox to untick, so it rides along untouched instead of vanishing.
                  const offered = (options ?? []).map((x) => x.value);
                  set([
                    ...offered.filter((v) => next.has(v)),
                    ...[...selected].filter((v) => !offered.includes(v)),
                  ]);
                }}
                className="h-4 w-4"
              />
              <span className="flex-1 text-[13px]" style={{ color: 'var(--c-ink)' }}>
                {o.label}
              </span>
            </label>
          ))}
        </div>
      );
    }
    case 'path':
      return (
        <PathControl
          value={typeof value === 'string' ? value : ''}
          set={set}
          disabled={disabled}
          label={decl.label ?? 'directory'}
        />
      );
    default:
      return null;
  }
}

/**
 * `lines`: one value per line. The text is buffered locally so a trailing newline
 * survives while the user types; the draft only ever holds the parsed list.
 */
function LinesControl({
  value,
  set,
  disabled,
  placeholder,
}: {
  value: unknown;
  set: (v: unknown) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  const list = Array.isArray(value) ? (value as string[]) : [];
  const [text, setText] = useState(list.join('\n'));
  const joined = list.join('\n');
  useEffect(() => {
    // Re-sync only when the list moved under us (a save, a refetch) — never
    // because the buffer holds an extra blank line the parse dropped.
    if (parseLines(text).join('\n') !== joined) setText(joined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);
  return (
    <textarea
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        set(parseLines(e.target.value));
      }}
      disabled={disabled}
      rows={3}
      spellCheck={false}
      placeholder={placeholder}
      className="w-full rounded-md px-3 py-1.5 text-[12.5px] font-mono resize-y"
      style={inputStyle}
    />
  );
}

/**
 * `path`: a cwd-relative directory. Typing works; "Browse…" opens the shared
 * `directory-browse` picker in relative mode, which refuses a folder outside the
 * project.
 */
export function PathControl({
  value,
  set,
  disabled,
  label,
  readOnlyText,
}: {
  value: string;
  set: (v: string) => void;
  disabled: boolean;
  label: string;
  /** The picker is the ONLY way to set the value (a root's `dir`). */
  readOnlyText?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          readOnly={readOnlyText}
          onChange={(e) => set(e.target.value)}
          disabled={disabled}
          className="w-full rounded-md px-3 py-1.5 text-[13px] font-mono"
          style={readOnlyText ? { ...inputStyle, opacity: 0.85 } : inputStyle}
          placeholder="relative to project root"
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
          style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
        >
          Browse…
        </button>
      </div>
      <DirectoryPickerModal
        open={open}
        onClose={() => setOpen(false)}
        mode="relative"
        onSelect={set}
        title={`Choose ${label.toLowerCase()}`}
      />
    </>
  );
}

function Counter({ value, max }: { value: unknown; max?: number }) {
  if (max === undefined) return null;
  const n = typeof value === 'string' ? value.length : 0;
  return (
    <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--c-subtle)' }}>
      {n}/{max}
    </span>
  );
}

/** Label + control + help/error, the layout every generated non-toggle element uses. */
export function ElementField({
  label,
  help,
  error,
  warning,
  asLabel = true,
  children,
}: {
  label?: string;
  help?: ReactNode;
  error?: string | null;
  warning?: string;
  /** Wrap in a `<label>`, naming the control inside; off for a group of controls. */
  asLabel?: boolean;
  children: ReactNode;
}) {
  const Wrapper = asLabel ? 'label' : 'div';
  return (
    <Wrapper className="flex flex-col gap-1.5">
      {label ? (
        <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
          {label}
        </span>
      ) : null}
      {children}
      {error || warning ? (
        <Feedback error={error ?? null} warning={warning} />
      ) : help ? (
        <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
          {help}
        </span>
      ) : null}
    </Wrapper>
  );
}

export function Feedback({ error, warning }: { error: string | null; warning?: string }) {
  if (error) {
    return (
      <span className="text-[11.5px]" role="alert" style={{ color: '#a83232' }}>
        {error}
      </span>
    );
  }
  if (warning) {
    return (
      <span className="text-[11.5px]" style={{ color: '#a87033' }}>
        {warning}
      </span>
    );
  }
  return null;
}

export const inputStyle: React.CSSProperties = {
  background: 'var(--c-bg)',
  border: '1px solid var(--c-hair)',
  color: 'var(--c-ink)',
};
