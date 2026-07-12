import { useState, type FormEvent } from 'react';
import { METHOD_STYLE } from '../../components/atoms.js';
import { Dialog, FormShell, FormField, ActionButton, Badge } from '../../host-ui-kit/index.js';
import { useCreateEndpoint } from '../../hooks/useEndpoints.js';
import { toast } from '../../ui/events.js';
import type { HttpMethod } from '../../../shared/entities.js';

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

export function EndpointCreateDialog({ onClose, onCreated }: Props) {
  const [method, setMethod] = useState<HttpMethod>('POST');
  const [path, setPath] = useState('/api/');
  const [summary, setSummary] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
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
      setFormError((err as Error).message || 'Failed to create endpoint');
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submit();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={
        <div className="flex items-center gap-1.5 min-w-0">
          <span>New endpoint</span>
          <span className="flex-1" />
          <span className="font-mono text-[11px] font-normal" style={{ color: 'var(--c-muted)' }}>
            slug:
          </span>
          <span className="font-mono text-[11px] font-normal truncate" style={{ color: 'var(--c-ink)' }}>
            {slug || '—'}
          </span>
        </div>
      }
    >
      <FormShell
        onSubmit={handleSubmit}
        busy={create.isPending}
        error={formError}
        actions={
          <>
            <ActionButton
              variant="ghost"
              label="Cancel"
              onClick={onClose}
              disabled={create.isPending}
            />
            <ActionButton
              type="submit"
              variant="primary"
              label={create.isPending ? 'Creating…' : 'Create'}
              disabled={!path || create.isPending}
            />
          </>
        }
      >
        <FormField label="Method & path">
          <div className="flex items-center gap-1.5">
            <div
              className="flex items-center rounded-md overflow-hidden"
              style={{ border: '1px solid var(--c-hair-strong)' }}
            >
              {METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
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
          <div className="flex items-center gap-1.5 text-[12px] mt-1.5" style={{ color: 'var(--c-muted)' }}>
            <Badge
              label={METHOD_STYLE[method].label}
              color={METHOD_STYLE[method].bg}
              foreground={METHOD_STYLE[method].fg}
              active
              dot={false}
              mono
              small
            />
            <span className="font-mono">{path}</span>
          </div>
        </FormField>
        <FormField label="Summary">
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
        </FormField>
        <FormField label="Tags">
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
        </FormField>
      </FormShell>
    </Dialog>
  );
}
