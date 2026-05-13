import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  type LucideIcon,
} from 'lucide-react';
import { useChatStore } from '../state/chat.js';
import { refreshAnnotations } from './extensions/AnnotationHighlight.js';

interface Props {
  editor: Editor | null;
  currentPage: string;
}

interface FormatAction {
  key: string;
  icon: LucideIcon;
  title: string;
  isActive: () => boolean;
  run: () => void;
}

export function AnnotationBubble({ editor, currentPage }: Props) {
  const addAnnotation = useChatStore((s) => s.addAnnotation);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [selectedRange, setSelectedRange] = useState<{ from: number; to: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [, setTick] = useState(0);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      setTick((t) => t + 1);
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        setPos(null);
        setOpen(false);
        return;
      }
      const text = editor.state.doc.textBetween(from, to, ' ');
      if (!text.trim()) {
        setPos(null);
        setOpen(false);
        return;
      }
      setSelectedText(text);
      setSelectedRange({ from, to });
      try {
        const startCoords = editor.view.coordsAtPos(from);
        const endCoords = editor.view.coordsAtPos(to);
        const top = Math.min(startCoords.top, endCoords.top) - 40;
        const left = (startCoords.left + endCoords.left) / 2;
        setPos({ top: Math.max(top, 8), left });
      } catch {
        setPos(null);
      }
    };

    editor.on('selectionUpdate', update);
    editor.on('blur', () => {
      // keep popup if focus moved inside popup
      setTimeout(() => {
        if (popupRef.current?.contains(document.activeElement)) return;
      }, 0);
    });
    return () => {
      editor.off('selectionUpdate', update);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        if (!editor.state.selection.empty) setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  const handleAdd = () => {
    if (!selectedText || !selectedRange) return;
    addAnnotation({
      id: nanoid(8),
      text: selectedText,
      comment,
      page: currentPage,
      range: selectedRange,
    });
    setComment('');
    setOpen(false);
    if (editor) refreshAnnotations(editor.view);
  };

  if (!pos || !editor) return null;

  const formatActions: FormatAction[] = [
    {
      key: 'h1',
      icon: Heading1,
      title: 'Heading 1',
      isActive: () => editor.isActive('heading', { level: 1 }),
      run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      key: 'h2',
      icon: Heading2,
      title: 'Heading 2',
      isActive: () => editor.isActive('heading', { level: 2 }),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: 'h3',
      icon: Heading3,
      title: 'Heading 3',
      isActive: () => editor.isActive('heading', { level: 3 }),
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      key: 'bold',
      icon: Bold,
      title: 'Bold (⌘B)',
      isActive: () => editor.isActive('bold'),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      key: 'italic',
      icon: Italic,
      title: 'Italic (⌘I)',
      isActive: () => editor.isActive('italic'),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      key: 'strike',
      icon: Strikethrough,
      title: 'Strikethrough',
      isActive: () => editor.isActive('strike'),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      key: 'code',
      icon: Code,
      title: 'Inline code',
      isActive: () => editor.isActive('code'),
      run: () => editor.chain().focus().toggleCode().run(),
    },
    {
      key: 'bullet',
      icon: List,
      title: 'Bullet list',
      isActive: () => editor.isActive('bulletList'),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      key: 'ordered',
      icon: ListOrdered,
      title: 'Numbered list',
      isActive: () => editor.isActive('orderedList'),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      key: 'quote',
      icon: Quote,
      title: 'Blockquote',
      isActive: () => editor.isActive('blockquote'),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
  ];

  return (
    <div
      ref={popupRef}
      className="fixed z-50 rounded-md shadow-lg"
      style={{
        top: pos.top,
        left: pos.left,
        transform: 'translateX(-50%)',
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair-strong)',
        minWidth: open ? 320 : undefined,
        maxWidth: open ? 420 : undefined,
      }}
    >
      {!open ? (
        <div className="flex items-center gap-0.5 px-1 py-1">
          {formatActions.map((a) => {
            const Icon = a.icon;
            const active = a.isActive();
            return (
              <button
                key={a.key}
                type="button"
                title={a.title}
                aria-label={a.title}
                aria-pressed={active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={a.run}
                className="inline-flex items-center justify-center rounded transition"
                style={{
                  width: 26,
                  height: 26,
                  background: active ? 'var(--c-panel)' : 'transparent',
                  color: active ? 'var(--c-accent)' : 'var(--c-ink)',
                  cursor: 'pointer',
                }}
              >
                <Icon size={13} />
              </button>
            );
          })}
          <span
            aria-hidden
            className="mx-1 self-stretch"
            style={{ width: 1, background: 'var(--c-hair)' }}
          />
          <button
            type="button"
            onClick={() => setOpen(true)}
            onMouseDown={(e) => e.preventDefault()}
            className="px-2 py-1 text-[12px] rounded"
            style={{ color: 'var(--c-accent)', cursor: 'pointer' }}
          >
            + Add to chat
          </button>
        </div>
      ) : (
        <div className="p-2">
          <div
            className="text-[11px] italic mb-1 truncate"
            style={{ color: 'var(--c-muted)' }}
            title={selectedText}
          >
            "{selectedText.slice(0, 100)}{selectedText.length > 100 ? '…' : ''}"
          </div>
          <textarea
            autoFocus
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="Add a comment (optional)…"
            className="w-full text-[12px] p-1.5 rounded bg-transparent outline-none"
            style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
          />
          <div className="flex items-center justify-end gap-1 mt-1.5">
            <button
              onClick={() => {
                setOpen(false);
                setComment('');
              }}
              className="px-2 py-1 text-[11px]"
              style={{ color: 'var(--c-muted)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              onMouseDown={(e) => e.preventDefault()}
              className="px-2.5 py-1 text-[11px] rounded"
              style={{ background: 'var(--c-accent)', color: 'white' }}
            >
              Add to chat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
