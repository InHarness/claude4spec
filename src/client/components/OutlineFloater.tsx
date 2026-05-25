import type { Editor } from '@tiptap/react';
import { useOutlineStore } from '../state/outline.js';
import {
  useHeadingsOutline,
  scrollToHeading,
} from '../hooks/useHeadingsOutline.js';

interface Props {
  editor: Editor | null;
}

export function OutlineFloater({ editor }: Props) {
  const outlineOpen = useOutlineStore((s) => s.outlineOpen);
  const items = useHeadingsOutline(editor);

  if (!outlineOpen || !editor) return null;

  return (
    <nav aria-label="Document outline">
      <div
        style={{
          color: 'var(--c-subtle)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginBottom: 10,
          paddingBottom: 6,
          borderBottom: '1px solid var(--c-hair)',
        }}
      >
        Outline
      </div>
      {items.length === 0 ? (
        <div
          style={{
            color: 'var(--c-subtle)',
            fontStyle: 'italic',
            fontSize: 12,
          }}
        >
          Brak nagłówków
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((item) => (
            <li key={item.pos}>
              <button
                type="button"
                onClick={() => scrollToHeading(editor, item.pos)}
                title={item.text || '(empty heading)'}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '3px 0',
                  paddingLeft: `${(item.level - 1) * 10}px`,
                  color: 'var(--c-muted)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  lineHeight: 1.45,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.12s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--c-accent-ink)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--c-muted)';
                }}
              >
                {item.text || (
                  <span style={{ fontStyle: 'italic', color: 'var(--c-subtle)' }}>
                    (pusty)
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
