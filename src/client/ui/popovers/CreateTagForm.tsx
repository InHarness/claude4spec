import { useEffect, useRef, useState } from 'react';
import { Tag as TagIcon } from 'lucide-react';
import {
  FieldLabel,
  InlineError,
  PopoverFooter,
  PopoverShell,
  TextInput,
  type PopoverFormProps,
} from '../Popover.js';

export function CreateTagForm({ request, onClose }: PopoverFormProps<'create-tag'>) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => nameRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Tag name is required');
      return;
    }
    onClose({ name: trimmed });
  }

  const contextLabel = request.props.contextLabel;

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={300}
      estHeight={160}
      onCancel={() => onClose(null)}
      title={contextLabel ? `Add tag to ${contextLabel}` : 'New tag'}
      icon={<TagIcon size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      <FieldLabel>Tag name</FieldLabel>
      <TextInput
        ref={nameRef}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="auth"
      />
      <InlineError message={error} />
      <PopoverFooter
        onCancel={() => onClose(null)}
        onSubmit={submit}
        submitLabel="Add"
      />
    </PopoverShell>
  );
}
