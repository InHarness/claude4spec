import { useEffect, useRef, useState } from 'react';
import { AtSign, Package } from 'lucide-react';
import {
  FieldLabel,
  InlineError,
  PopoverFooter,
  PopoverShell,
  SelectInput,
  TextInput,
  type PopoverFormProps,
} from '../Popover.js';
import { listActiveEntityTypes } from '../../entities/index.js';
import type { EntityType } from '../../../shared/entities.js';

// Handles `mention` and `element` popover kinds — both ask for { type, slug }.
export function MentionForm(props: PopoverFormProps<'mention'>) {
  return <EntityRefForm {...props} title="Inline mention" iconKind="mention" />;
}

export function ElementForm(props: PopoverFormProps<'element'>) {
  return <EntityRefForm {...props} title="Single element" iconKind="element" />;
}

interface InnerProps {
  request: PopoverFormProps<'mention'>['request'] | PopoverFormProps<'element'>['request'];
  onClose: (result: { type: EntityType; slug: string } | null) => void;
  title: string;
  iconKind: 'mention' | 'element';
}

function EntityRefForm({ request, onClose, title, iconKind }: InnerProps) {
  // 0.2.11: default to the first ACTIVE type, not a hardcoded 'endpoint'. The
  // <option> list is registry-driven now, so a project without `endpoint`
  // (deactivated, or its envelope failed to load — a FAIL-SOFT state this host
  // documents) would render a <select> whose value matches no option: the browser
  // shows the first real one while state still says 'endpoint', and the chip is
  // written with a type the project does not have.
  const [type, setType] = useState<EntityType>(() => listActiveEntityTypes()[0] ?? '');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const slugRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => slugRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  function submit() {
    const trimmed = slug.trim();
    if (!trimmed) {
      setError('Slug is required');
      return;
    }
    onClose({ type, slug: trimmed });
  }

  const Icon = iconKind === 'mention' ? AtSign : Package;

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={340}
      onCancel={() => onClose(null)}
      title={title}
      icon={<Icon size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ width: 140 }}>
          <FieldLabel>Type</FieldLabel>
          <SelectInput value={type} onChange={(e) => setType(e.target.value as EntityType)}>
            {listActiveEntityTypes().map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectInput>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FieldLabel>Slug</FieldLabel>
          <TextInput
            ref={slugRef}
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="get-users"
            style={{ fontFamily: 'ui-monospace, monospace' }}
          />
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
