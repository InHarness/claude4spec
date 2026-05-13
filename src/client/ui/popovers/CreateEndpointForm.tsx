import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import {
  FieldLabel,
  InlineError,
  PopoverFooter,
  PopoverShell,
  SelectInput,
  TextInput,
  type PopoverFormProps,
} from '../Popover.js';
import { HTTP_METHODS } from '../events.js';
import type { HttpMethod } from '../../../shared/entities.js';

export function CreateEndpointForm({ request, onClose }: PopoverFormProps<'create-endpoint'>) {
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [path, setPath] = useState('/api/');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pathRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      pathRef.current?.focus();
      pathRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  function submit() {
    const trimmedPath = path.trim();
    if (!trimmedPath) {
      setError('Path is required');
      return;
    }
    if (!trimmedPath.startsWith('/')) {
      setError('Path must start with /');
      return;
    }
    onClose({
      method,
      path: trimmedPath,
      ...(summary.trim() ? { summary: summary.trim() } : {}),
    });
  }

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={360}
      estHeight={260}
      onCancel={() => onClose(null)}
      title="New endpoint"
      icon={<ArrowRightLeft size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ width: 100 }}>
          <FieldLabel>Method</FieldLabel>
          <SelectInput value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </SelectInput>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FieldLabel>Path</FieldLabel>
          <TextInput
            ref={pathRef}
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
            placeholder="/api/users"
            style={{ fontFamily: 'ui-monospace, monospace' }}
          />
        </div>
      </div>
      <FieldLabel>Summary (optional)</FieldLabel>
      <TextInput
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="List all users"
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
