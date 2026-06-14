import { useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import { useCreateDesignSystem } from '../hooks/useDesignSystems.js';

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
  const rootRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!request) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) cancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const { x, y } = clampToViewport(request.x, request.y);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Create design system"
      className="rounded-md shadow-lg"
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 1100,
        width: 320,
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair-strong)',
        padding: 12,
      }}
    >
      <div
        className="flex items-center gap-2 mb-2 text-[11px] uppercase font-mono tracking-wider"
        style={{ color: 'var(--c-subtle)' }}
      >
        <Palette size={12} style={{ color: 'var(--c-accent)' }} />
        New design system
      </div>
      <input
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
        spellCheck={false}
        className="w-full text-[13.5px] bg-transparent outline-none mb-2 px-2 py-1 rounded"
        style={{ color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="What this design system covers (optional)"
        className="w-full text-[12.5px] bg-transparent outline-none mb-2 px-2 py-1 rounded"
        style={{ color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
      />
      {error && (
        <div className="text-[11.5px] mb-2" style={{ color: 'var(--c-red, #c45a3b)' }}>
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={cancel}
          className="text-[12px] px-2 py-1 rounded"
          style={{ color: 'var(--c-muted)' }}
        >
          Cancel
        </button>
        <button
          onClick={() => void submit()}
          disabled={create.isPending}
          className="text-[12px] px-3 py-1 rounded font-medium"
          style={{
            background: 'var(--c-accent)',
            color: '#fff',
            opacity: create.isPending ? 0.6 : 1,
          }}
        >
          {create.isPending ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  );
}

function clampToViewport(x: number, y: number): { x: number; y: number } {
  const width = 320;
  const estHeight = 200;
  const pad = 8;
  const maxX = window.innerWidth - width - pad;
  const maxY = window.innerHeight - estHeight - pad;
  return {
    x: Math.max(pad, Math.min(x, maxX)),
    y: Math.max(pad, Math.min(y, maxY)),
  };
}
