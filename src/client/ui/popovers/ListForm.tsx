import { useEffect, useRef, useState } from 'react';
import { List } from 'lucide-react';
import {
  FieldLabel,
  InlineError,
  PopoverFooter,
  PopoverShell,
  SelectInput,
  TextInput,
  type PopoverFormProps,
} from '../Popover.js';
import { ENTITY_TYPES } from '../events.js';
import type { EntityType } from '../../../shared/entities.js';

export function ListForm({ request, onClose }: PopoverFormProps<'list'>) {
  const [type, setType] = useState<EntityType>('endpoint');
  const [slugsRaw, setSlugsRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  function submit() {
    const slugs = slugsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (slugs.length === 0) {
      setError('At least one slug required');
      return;
    }
    onClose({ type, slugs });
  }

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={360}
      estHeight={220}
      onCancel={() => onClose(null)}
      title="Element list"
      icon={<List size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      <FieldLabel>Type</FieldLabel>
      <SelectInput
        value={type}
        onChange={(e) => setType(e.target.value as EntityType)}
        style={{ marginBottom: 8 }}
      >
        {ENTITY_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </SelectInput>
      <FieldLabel>Slugs (comma-separated)</FieldLabel>
      <TextInput
        ref={inputRef}
        value={slugsRaw}
        onChange={(e) => {
          setSlugsRaw(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="get-users, create-user"
        style={{ fontFamily: 'ui-monospace, monospace' }}
      />
      <InlineError message={error} />
      <PopoverFooter
        onCancel={() => onClose(null)}
        onSubmit={submit}
        submitLabel="Insert"
      />
    </PopoverShell>
  );
}
