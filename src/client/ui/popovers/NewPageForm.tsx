import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import {
  FieldLabel,
  InlineError,
  PopoverFooter,
  PopoverShell,
  TextInput,
  type PopoverFormProps,
} from '../Popover.js';

export function NewPageForm({ request, onClose }: PopoverFormProps<'new-page'>) {
  const [path, setPath] = useState('untitled.md');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  function submit() {
    const trimmed = path.trim().replace(/^\/+/, '');
    if (!trimmed) {
      setError('Path is required');
      return;
    }
    if (!trimmed.endsWith('.md')) {
      setError('Page name must end with .md');
      return;
    }
    onClose({ path: trimmed });
  }

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={360}
      estHeight={150}
      onCancel={() => onClose(null)}
      title="New page"
      icon={<FileText size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      <FieldLabel>Path (relative to pages/)</FieldLabel>
      <TextInput
        ref={inputRef}
        value={path}
        onChange={(e) => {
          setPath(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="modules/m03-endpoint.md"
        style={{ fontFamily: 'ui-monospace, monospace' }}
      />
      <InlineError message={error} />
      <PopoverFooter
        onCancel={() => onClose(null)}
        onSubmit={submit}
        submitLabel="Create"
      />
    </PopoverShell>
  );
}
