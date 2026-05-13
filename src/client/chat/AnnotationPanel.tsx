import { useState } from 'react';
import { AtSign, X, Pencil } from 'lucide-react';
import { useChatStore } from '../state/chat.js';

export function AnnotationPanel() {
  const annotations = useChatStore((s) => s.annotations);
  const updateAnnotation = useChatStore((s) => s.updateAnnotation);
  const removeAnnotation = useChatStore((s) => s.removeAnnotation);
  const clearAnnotations = useChatStore((s) => s.clearAnnotations);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (annotations.length === 0) return null;

  return (
    <div className="px-3 pt-2 pb-1" style={{ borderTop: '1px solid var(--c-hair)' }}>
      <div
        className="flex items-center gap-2 mb-1.5 text-[11px]"
        style={{ color: 'var(--c-muted)' }}
      >
        <AtSign size={11} />
        <span className="font-mono uppercase tracking-wider">
          Annotations ({annotations.length})
        </span>
        <span className="flex-1" />
        <button onClick={clearAnnotations} className="hover:underline">
          Clear all
        </button>
      </div>
      <div className="space-y-1.5 max-h-32 overflow-auto nice-scroll">
        {annotations.map((a) => (
          <div
            key={a.id}
            className="rounded-md p-2"
            style={{ background: 'var(--c-yellow)', border: '1px solid rgba(0,0,0,0.1)' }}
          >
            <div
              className="flex items-center gap-1.5 text-[9.5px] font-mono uppercase tracking-wider mb-1"
              style={{ color: 'var(--c-yellow-ink)' }}
            >
              <span className="truncate">{a.page}</span>
              <span className="flex-1" />
              <button onClick={() => setEditingId(editingId === a.id ? null : a.id)} title="Edit">
                <Pencil size={10} />
              </button>
              <button onClick={() => removeAnnotation(a.id)} title="Remove">
                <X size={10} />
              </button>
            </div>
            <div
              className="font-serif italic text-[12px] mb-1"
              style={{ color: 'var(--c-yellow-ink)' }}
            >
              "{a.text.slice(0, 140)}{a.text.length > 140 ? '…' : ''}"
            </div>
            {editingId === a.id ? (
              <textarea
                autoFocus
                defaultValue={a.comment}
                onBlur={(e) => {
                  updateAnnotation(a.id, e.currentTarget.value);
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditingId(null);
                }}
                rows={2}
                className="w-full text-[11.5px] p-1 rounded bg-transparent outline-none"
                style={{
                  border: '1px solid rgba(0,0,0,0.15)',
                  color: 'var(--c-ink)',
                }}
              />
            ) : (
              a.comment && (
                <div className="text-[11.5px]" style={{ color: 'var(--c-ink)' }}>
                  {a.comment}
                </div>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
