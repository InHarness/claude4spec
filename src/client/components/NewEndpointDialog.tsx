import { useState } from 'react';
import { ArrowRightLeft, Plus, X } from 'lucide-react';
import { MethodBadge, METHOD_STYLE } from './atoms.js';
import { useCreateEndpoint } from '../hooks/useEndpoints.js';
import { toast } from '../ui/events.js';
import type { HttpMethod } from '../../shared/entities.js';

interface Props {
  onClose: () => void;
  onCreated: (slug: string) => void;
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function livePreviewSlug(method: string, path: string): string {
  const base = `${method.toLowerCase()}-${path
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;
  return base.replace(/^-+|-+$/g, '');
}

export function NewEndpointDialog({ onClose, onCreated }: Props) {
  const [method, setMethod] = useState<HttpMethod>('POST');
  const [path, setPath] = useState('/api/');
  const [summary, setSummary] = useState('');
  const [tagsText, setTagsText] = useState('');
  const create = useCreateEndpoint();

  const slug = livePreviewSlug(method, path);

  async function submit() {
    const tagList = tagsText
      .split(/[, ]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const ep = await create.mutateAsync({
        method,
        path,
        summary: summary || undefined,
        tags: tagList.length ? tagList : undefined,
      });
      onCreated(ep.slug);
      toast.success(`Endpoint ${ep.method} ${ep.path} created`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.35)' }}>
      <div
        className="rounded-lg shadow-2xl"
        style={{
          width: 440,
          background: 'var(--c-card)',
          border: '1px solid var(--c-accent)',
        }}
      >
        <div
          className="px-3 py-2 flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider"
          style={{
            color: 'var(--c-accent-ink)',
            background: 'var(--c-accent-soft)',
            borderBottom: '1px solid var(--c-hair)',
          }}
        >
          <ArrowRightLeft size={12} />
          New endpoint
          <span className="flex-1" />
          <span style={{ color: 'var(--c-muted)' }}>slug:</span>
          <span style={{ color: 'var(--c-ink)' }}>{slug || '—'}</span>
          <button onClick={onClose} style={{ color: 'var(--c-muted)' }} className="ml-2">
            <X size={13} />
          </button>
        </div>
        <div className="p-3 space-y-3">
          <div className="flex items-center gap-1.5">
            <div
              className="flex items-center rounded-md overflow-hidden"
              style={{ border: '1px solid var(--c-hair-strong)' }}
            >
              {METHODS.map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className="px-2 py-1 text-[11px] font-mono font-semibold"
                  style={{
                    background: method === m ? METHOD_STYLE[m].bg : 'transparent',
                    color: method === m ? METHOD_STYLE[m].fg : 'var(--c-muted)',
                  }}
                >
                  {METHOD_STYLE[m].label}
                </button>
              ))}
            </div>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              autoFocus
              className="flex-1 rounded-md px-2 py-1 text-[12.5px] font-mono outline-none"
              style={{
                background: 'var(--c-panel)',
                border: '1px solid var(--c-hair)',
                color: 'var(--c-ink)',
              }}
              placeholder="/api/..."
            />
          </div>
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="w-full rounded-md px-2 py-1 text-[12.5px] outline-none"
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-hair)',
              color: 'var(--c-ink)',
            }}
            placeholder="Short summary"
          />
          <input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            className="w-full rounded-md px-2 py-1 text-[12.5px] outline-none font-mono"
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-hair)',
              color: 'var(--c-ink)',
            }}
            placeholder="tags (comma separated, auto-created)"
          />
          <div className="flex items-center gap-2 pt-1">
            <div className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--c-muted)' }}>
              <MethodBadge method={method} />
              <span className="font-mono">{path}</span>
            </div>
            <span className="flex-1" />
            <button
              onClick={onClose}
              className="px-2.5 py-1 rounded-md text-[11.5px]"
              style={{ color: 'var(--c-muted)' }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!path || create.isPending}
              className="px-2.5 py-1 rounded-md text-[11.5px] font-medium inline-flex items-center gap-1.5"
              style={{ background: 'var(--c-accent)', color: '#fff', opacity: path ? 1 : 0.5 }}
            >
              <Plus size={11} /> {create.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
