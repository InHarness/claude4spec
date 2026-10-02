import { useState } from 'react';
import { Edit3 } from 'lucide-react';
import { InlineError, PopoverFooter, PopoverShell, type PopoverFormProps } from '../Popover.js';
import type { XmlTagAttrs } from '../events.js';
import { getTagPopoverFields } from '../../xml-markup/popover-fields.js';

function sameAttrs(a: XmlTagAttrs, b: XmlTagAttrs): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  return true;
}

/**
 * 2.1.2 (M51/M20) — the one popover of every XML tag. The convention lives
 * here: the shell, Cancel, Create / Save, Remove (edit only), and Save
 * enabled only once the value differs from what the tag already carries. The
 * fields, their validation and normalization come from the module that owns
 * the tag (`registerTagPopoverFields`).
 */
export function XmlTagForm({ request, onClose }: PopoverFormProps<'xml-tag'>) {
  const { name, mode, attrs: initial, onRemove } = request.props;
  const def = getTagPopoverFields(name);
  const [value, setValue] = useState<XmlTagAttrs>(initial);
  const [error, setError] = useState<string | null>(null);

  if (!def) {
    // A tag without fields has nothing to edit; close rather than show an empty shell.
    queueMicrotask(() => onClose(null));
    return null;
  }

  const normalize = def.normalize ?? ((v: XmlTagAttrs) => v);
  const unchanged = mode === 'edit' && sameAttrs(normalize(value), normalize(initial));
  const invalid = def.validate?.(normalize(value), mode) ?? null;

  function submit(next?: XmlTagAttrs) {
    const candidate = normalize(next ?? value);
    const message = def!.validate?.(candidate, mode) ?? null;
    if (message) {
      setError(message);
      return;
    }
    if (mode === 'edit' && sameAttrs(candidate, normalize(initial))) return;
    onClose(candidate);
  }

  const { Fields } = def;
  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={def.width ?? 300}
      onCancel={() => onClose(null)}
      title={mode === 'edit' ? def.title.edit : def.title.create}
      icon={def.icon ?? <Edit3 size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      <Fields
        mode={mode}
        value={value}
        onChange={(next) => {
          setValue(next);
          if (error) setError(null);
        }}
        submit={submit}
      />
      <InlineError message={error} />
      <PopoverFooter
        onCancel={() => onClose(null)}
        onSubmit={() => submit()}
        submitLabel={mode === 'edit' ? 'Save' : 'Create'}
        disabled={unchanged || (mode === 'create' && invalid !== null)}
        {...(mode === 'edit' && onRemove
          ? {
              onRemove: () => {
                onRemove();
                onClose(null);
              },
            }
          : {})}
      />
    </PopoverShell>
  );
}
