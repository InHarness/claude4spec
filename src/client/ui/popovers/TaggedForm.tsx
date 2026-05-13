import { useEffect, useRef, useState } from 'react';
import { Tags } from 'lucide-react';
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

type FilterMode = 'and' | 'or';

function useTagsAndFilter() {
  const [tagsRaw, setTagsRaw] = useState('');
  const [filter, setFilter] = useState<FilterMode>('and');
  const [error, setError] = useState<string | null>(null);
  return { tagsRaw, setTagsRaw, filter, setFilter, error, setError };
}

export function TaggedForm({ request, onClose }: PopoverFormProps<'tagged'>) {
  const [type, setType] = useState<EntityType>('endpoint');
  const { tagsRaw, setTagsRaw, filter, setFilter, error, setError } = useTagsAndFilter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  function submit() {
    const tags = tagsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tags.length === 0) {
      setError('At least one tag required');
      return;
    }
    onClose({ type, tags, filter });
  }

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={360}
      estHeight={240}
      onCancel={() => onClose(null)}
      title="Tagged list"
      icon={<Tags size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <FieldLabel>Type</FieldLabel>
          <SelectInput value={type} onChange={(e) => setType(e.target.value as EntityType)}>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectInput>
        </div>
        <div style={{ width: 110 }}>
          <FieldLabel>Filter</FieldLabel>
          <SelectInput value={filter} onChange={(e) => setFilter(e.target.value as FilterMode)}>
            <option value="and">and</option>
            <option value="or">or</option>
          </SelectInput>
        </div>
      </div>
      <FieldLabel>Tags (comma-separated)</FieldLabel>
      <TextInput
        ref={inputRef}
        value={tagsRaw}
        onChange={(e) => {
          setTagsRaw(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="auth, core"
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

export function TaggedMixedForm({ request, onClose }: PopoverFormProps<'tagged-mixed'>) {
  const { tagsRaw, setTagsRaw, filter, setFilter, error, setError } = useTagsAndFilter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  function submit() {
    const tags = tagsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tags.length === 0) {
      setError('At least one tag required');
      return;
    }
    onClose({ tags, filter });
  }

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={360}
      estHeight={220}
      onCancel={() => onClose(null)}
      title="Tagged list (mixed types)"
      icon={<Tags size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <FieldLabel>Tags (comma-separated)</FieldLabel>
          <TextInput
            ref={inputRef}
            value={tagsRaw}
            onChange={(e) => {
              setTagsRaw(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="auth, core"
          />
        </div>
        <div style={{ width: 110 }}>
          <FieldLabel>Filter</FieldLabel>
          <SelectInput value={filter} onChange={(e) => setFilter(e.target.value as FilterMode)}>
            <option value="and">and</option>
            <option value="or">or</option>
          </SelectInput>
        </div>
      </div>
      <InlineError message={error} />
      <PopoverFooter
        onCancel={() => onClose(null)}
        onSubmit={submit}
        submitLabel="Insert"
      />
    </PopoverShell>
  );
}
