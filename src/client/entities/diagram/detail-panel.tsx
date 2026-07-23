import { useEffect, useMemo, useState } from 'react';
import type { EntityDetailProps } from '../registry.js';
import { useDiagram, useUpdateDiagram, useDeleteDiagram } from '../../hooks/useDiagrams.js';
import {
  renderDiagram,
  hashSource,
  sanitizeRenderId,
  isSupportedFormat,
} from '../../tiptap/extensions/diagramRender.js';
import { toast } from '../../ui/events.js';
import { useReferences } from '../../hooks/useReferences.js';
import { useTheme } from '../../state/tweaks.js';
import { EntityDetailToolbar } from '../../host-ui-kit/detail/EntityDetailToolbar.js';
import { FormShell } from '../../host-ui-kit/overlay/FormShell.js';
import { FormField } from '../../host-ui-kit/form/FormField.js';
import { ActionButton } from '../../host-ui-kit/actions/ActionButton.js';

type Preview =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'rendered'; svg: string }
  | { status: 'error'; message: string };

export function DiagramDetail({ slug, onDeleted, onBack }: EntityDetailProps) {
  const { data: diagram, isLoading } = useDiagram(slug || null);
  const updateDiagram = useUpdateDiagram();
  const deleteDiagram = useDeleteDiagram();
  const { data: refs = [] } = useReferences('diagram', slug || null);

  const [draft, setDraft] = useState<string | null>(null);
  const source = draft ?? diagram?.source ?? '';
  const format = diagram?.format ?? 'mermaid';
  const dirty = draft !== null && draft !== (diagram?.source ?? '');

  const { effectiveTheme } = useTheme();

  const [preview, setPreview] = useState<Preview>({ status: 'idle' });
  const renderId = useMemo(
    () => sanitizeRenderId(`detail-${hashSource(source)}-${Math.random().toString(36).slice(2, 6)}`),
    [source, effectiveTheme],
  );

  useEffect(() => {
    let cancelled = false;
    if (!source.trim()) {
      setPreview({ status: 'idle' });
      return;
    }
    if (!isSupportedFormat(format)) {
      setPreview({ status: 'error', message: `Unsupported format: ${format}` });
      return;
    }
    setPreview({ status: 'loading' });
    renderDiagram(format, source, renderId, effectiveTheme).then((r) => {
      if (cancelled) return;
      setPreview(r.ok ? { status: 'rendered', svg: r.svg } : { status: 'error', message: r.message });
    });
    return () => {
      cancelled = true;
    };
  }, [format, source, renderId, effectiveTheme]);

  function save() {
    if (!dirty) return;
    updateDiagram.mutate(
      { slug, input: { source } },
      {
        onSuccess: () => {
          setDraft(null);
          toast.success('Diagram saved');
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
  }

  function remove() {
    deleteDiagram.mutate(slug, {
      onSuccess: () => onDeleted(),
      onError: (err) => toast.error((err as Error).message),
    });
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--c-bg)' }}>
      <EntityDetailToolbar
        title={`${slug} · ${format}`}
        onBack={onBack}
        onDelete={remove}
        brokenRefs={refs.map((r) => ({ type: 'page', slug: r.pagePath }))}
        busy={deleteDiagram.isPending}
      />

      {isLoading ? (
        <div className="p-4 text-[12px]" style={{ color: 'var(--c-subtle)' }}>
          Loading…
        </div>
      ) : !diagram ? (
        <div className="p-4 text-[12px]" style={{ color: 'var(--c-red, #c45a3b)' }}>
          Diagram not found.
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-3 flex flex-col gap-3">
          <div
            className="rounded"
            style={{
              background: 'var(--c-card)',
              border: '1px solid var(--c-hair)',
              padding: 12,
              minHeight: 80,
            }}
          >
            {preview.status === 'rendered' ? (
              <div className="c4s-diagram-svg" dangerouslySetInnerHTML={{ __html: preview.svg }} />
            ) : preview.status === 'error' ? (
              <div className="text-[12px] font-mono" style={{ color: 'var(--c-red, #c45a3b)' }}>
                {preview.message}
              </div>
            ) : preview.status === 'loading' ? (
              <div className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
                Rendering…
              </div>
            ) : (
              <div className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
                Empty diagram.
              </div>
            )}
          </div>

          <FormShell
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            busy={updateDiagram.isPending}
            actions={
              <>
                {dirty && (
                  <ActionButton label="Revert" variant="secondary" onClick={() => setDraft(null)} />
                )}
                <ActionButton
                  label={updateDiagram.isPending ? 'Saving…' : 'Save source'}
                  type="submit"
                  variant="primary"
                  disabled={!dirty || updateDiagram.isPending}
                />
              </>
            }
          >
            <FormField label="Source">
              <textarea
                value={source}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="w-full rounded font-mono text-[12px] p-2"
                style={{
                  background: 'var(--c-panel)',
                  color: 'var(--c-ink)',
                  border: '1px solid var(--c-hair)',
                  minHeight: 160,
                  resize: 'vertical',
                }}
              />
            </FormField>
          </FormShell>

          {diagram.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {diagram.tags.map((t) => (
                <span
                  key={t}
                  className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
                >
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
