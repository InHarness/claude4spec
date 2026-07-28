import { useEffect, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
import { useCreateUiView } from '../hooks/useUiViews.js';
import { PopoverShell, TextInput, InlineError, PopoverFooter } from '../ui/Popover.js';

export interface NewUiViewRequest {
  x: number;
  y: number;
  onCreated: (slug: string) => void;
  onCancelled?: () => void;
}

const EVENT_NAME = 'c4s:new-ui-view';

export function dispatchNewUiView(detail: NewUiViewRequest): void {
  window.dispatchEvent(new CustomEvent<NewUiViewRequest>(EVENT_NAME, { detail }));
}

export function NewUiViewPopover() {
  const [request, setRequest] = useState<NewUiViewRequest | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateUiView();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<NewUiViewRequest>;
      setRequest(ce.detail);
      setName('');
      setUrl('');
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
      const view = await create.mutateAsync({
        name: trimmed,
        url: url.trim() || null,
        description: description.trim() || undefined,
      });
      const req = request;
      setRequest(null);
      req.onCreated(view.slug);
    } catch (err) {
      const message = (err as Error).message ?? 'Failed to create view';
      setError(message);
    }
  }

  if (!request) return null;

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      onCancel={cancel}
      title="New UI view"
      icon={<Monitor size={12} style={{ color: 'var(--c-accent)' }} />}
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
        placeholder="User Profile Screen"
        className="mb-2"
      />
      <TextInput
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="/users/:id (empty = modal/drawer)"
        className="font-mono mb-2"
        style={{ fontSize: 12.5 }}
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
        placeholder="What this screen does (optional)"
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
