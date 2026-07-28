import { useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import { useCreateDesignSystem } from '../hooks/useDesignSystems.js';
import { PopoverShell, TextInput, InlineError, PopoverFooter } from '../ui/Popover.js';

export interface NewDesignSystemRequest {
  x: number;
  y: number;
  onCreated: (slug: string) => void;
  onCancelled?: () => void;
}

const EVENT_NAME = 'c4s:new-design-system';

export function dispatchNewDesignSystem(detail: NewDesignSystemRequest): void {
  window.dispatchEvent(new CustomEvent<NewDesignSystemRequest>(EVENT_NAME, { detail }));
}

export function NewDesignSystemPopover() {
  const [request, setRequest] = useState<NewDesignSystemRequest | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateDesignSystem();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<NewDesignSystemRequest>;
      setRequest(ce.detail);
      setName('');
      setDescription('');
      setError(null);
    };
    window.addEventListener(EVENT_NAME, handler as EventListener);
    return () => window.removeEventListener(EVENT_NAME, handler as EventListener);
  }, []);

  useEffect(() => {
    if (request) {
      const t = window.setTimeout(() => nameRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [request]);

  function cancel() {
    if (!request) return;
    request.onCancelled?.();
    setRequest(null);
  }

  async function submit() {
    if (!request) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    try {
      const ds = await create.mutateAsync({
        name: trimmed,
        description: description.trim() || undefined,
      });
      const req = request;
      setRequest(null);
      req.onCreated(ds.slug);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to create design system');
    }
  }

  if (!request) return null;

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      onCancel={cancel}
      title="New design system"
      icon={<Palette size={12} style={{ color: 'var(--c-accent)' }} />}
    >
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
            void submit();
          }
        }}
        placeholder="Brand 2026"
        className="mb-2"
      />
      <TextInput
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="What this design system covers (optional)"
        style={{ fontSize: 12.5 }}
      />
      <InlineError message={error} />
      <PopoverFooter
        onCancel={cancel}
        onSubmit={() => void submit()}
        submitLabel="Create"
        busy={create.isPending}
      />
    </PopoverShell>
  );
}
