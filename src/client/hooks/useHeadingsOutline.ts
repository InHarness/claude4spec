import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';

export interface OutlineItem {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  pos: number;
}

export function useHeadingsOutline(editor: Editor | null): OutlineItem[] {
  const [items, setItems] = useState<OutlineItem[]>([]);

  useEffect(() => {
    if (!editor) {
      setItems([]);
      return;
    }
    const extract = () => {
      const out: OutlineItem[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          const rawLevel = Number(node.attrs.level ?? 1);
          const level = (rawLevel >= 1 && rawLevel <= 6 ? rawLevel : 1) as OutlineItem['level'];
          const text = node.textContent.trim();
          out.push({ level, text, pos });
          return false;
        }
        return true;
      });
      setItems(out);
    };
    extract();
    editor.on('update', extract);
    editor.on('transaction', extract);
    return () => {
      editor.off('update', extract);
      editor.off('transaction', extract);
    };
  }, [editor]);

  return items;
}

export function scrollToHeading(editor: Editor, pos: number): void {
  const scroller = editor.view.dom.closest('.nice-scroll') as HTMLElement | null;
  if (!scroller) return;
  const { top } = editor.view.coordsAtPos(pos);
  const scrollerTop = scroller.getBoundingClientRect().top;
  scroller.scrollTo({
    top: scroller.scrollTop + (top - scrollerTop) - 24,
    behavior: 'smooth',
  });
}
