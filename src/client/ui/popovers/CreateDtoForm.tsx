import { useEffect, useRef, useState } from 'react';
import { Braces } from 'lucide-react';
import {
  FieldLabel,
  InlineError,
  PopoverFooter,
  PopoverShell,
  TextInput,
  type PopoverFormProps,
} from '../Popover.js';

export function CreateDtoForm({ request, onClose }: PopoverFormProps<'create-dto'>) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => nameRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    onClose({
      name: trimmed,
      ...(description.trim() ? { description: description.trim() } : {}),
    });
  }

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={340}
      estHeight={200}
      onCancel={() => onClose(null)}
      title="New DTO"
      icon={<Braces size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      <FieldLabel>Name (PascalCase)</FieldLabel>
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
        placeholder="UserResponse"
        style={{ fontFamily: 'ui-monospace, monospace' }}
      />
      <div style={{ marginTop: 8 }}>
        <FieldLabel>Description (optional)</FieldLabel>
        <TextInput
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Returned by GET /users"
        />
      </div>
      <InlineError message={error} />
      <PopoverFooter
        onCancel={() => onClose(null)}
        onSubmit={submit}
        submitLabel="Create"
      />
    </PopoverShell>
  );
}
