import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Editor } from '@tiptap/react';

interface OutlineState {
  editor: Editor | null;
  outlineOpen: boolean;
  setEditor(editor: Editor | null): void;
  setOutlineOpen(open: boolean): void;
  toggleOutline(): void;
}

export const useOutlineStore = create<OutlineState>()(
  persist(
    (set) => ({
      editor: null,
      outlineOpen: false,
      setEditor: (editor) => set({ editor }),
      setOutlineOpen: (open) => set({ outlineOpen: open }),
      toggleOutline: () => set((s) => ({ outlineOpen: !s.outlineOpen })),
    }),
    {
      name: 'c4s:shell:outline-open',
      version: 1,
      partialize: (s) => ({ outlineOpen: s.outlineOpen }),
    },
  ),
);
