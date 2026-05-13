import { List } from 'lucide-react';
import { useOutlineStore } from '../state/outline.js';

export function OutlineButton() {
  const editor = useOutlineStore((s) => s.editor);
  const outlineOpen = useOutlineStore((s) => s.outlineOpen);
  const toggleOutline = useOutlineStore((s) => s.toggleOutline);

  if (!editor) return null;

  return (
    <button
      type="button"
      onClick={toggleOutline}
      aria-pressed={outlineOpen}
      title={outlineOpen ? 'Hide outline' : 'Show outline'}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition"
      style={{
        background: outlineOpen ? 'var(--c-card)' : 'var(--c-panel)',
        color: outlineOpen ? 'var(--c-accent)' : 'var(--c-ink)',
        border: `1px solid ${outlineOpen ? 'var(--c-accent)' : 'var(--c-hair-strong)'}`,
        cursor: 'pointer',
      }}
    >
      <List size={12} />
      Outline
    </button>
  );
}
