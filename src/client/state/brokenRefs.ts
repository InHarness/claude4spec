import { useEffect, useId, useState } from 'react';
import { frontendPluginsBooted, pluginBootPending } from '../runtime/boot-plugins.js';
import { create } from 'zustand';
import type { Editor } from '@tiptap/core';

/**
 * 0.2.110 M19 — the broken references a page editor currently shows.
 *
 * A reference NodeView that ends up broken (its type is unknown / inactive, or
 * its entity does not exist) registers here with the way to remove itself; the
 * page editor reads the count for its "N broken references found" bar and runs
 * every remover for "Remove all broken references". No field is persisted.
 */
interface BrokenRefsState {
  entries: Record<string, { editorKey: string; remove: () => void }>;
  register(id: string, editorKey: string, remove: () => void): void;
  unregister(id: string): void;
}

export const useBrokenRefsStore = create<BrokenRefsState>((set) => ({
  entries: {},
  register: (id, editorKey, remove) =>
    set((s) => ({ entries: { ...s.entries, [id]: { editorKey, remove } } })),
  unregister: (id) =>
    set((s) => {
      if (!(id in s.entries)) return s;
      const { [id]: _gone, ...rest } = s.entries;
      return { entries: rest };
    }),
}));

const keys = new WeakMap<object, string>();
let next = 0;

/** A stable per-editor key (editors carry no id of their own). */
export function editorKey(editor: Editor | object): string {
  let k = keys.get(editor);
  if (!k) {
    k = `editor-${++next}`;
    keys.set(editor, k);
  }
  return k;
}

/**
 * NodeView side: report `broken` for as long as it holds.
 *
 * `unresolvedType` (no module for the type) is not reported while the plugin
 * frontends are still booting: a chip can mount before the envelope owning its
 * type registers, and the bar must not flash a count that is a load-order
 * artefact rather than a broken reference.
 */
export function useReportBrokenRef(
  editor: Editor,
  { unresolvedType, missingEntity }: { unresolvedType: boolean; missingEntity: boolean },
  remove: () => void,
): void {
  const id = useId();
  const key = editorKey(editor);
  const [booted, setBooted] = useState(() => !pluginBootPending());
  useEffect(() => {
    if (booted) return;
    let live = true;
    void frontendPluginsBooted.then(() => live && setBooted(true));
    return () => {
      live = false;
    };
  }, [booted]);
  const broken = missingEntity || (unresolvedType && booted);
  useEffect(() => {
    if (!broken) return;
    useBrokenRefsStore.getState().register(id, key, remove);
    return () => useBrokenRefsStore.getState().unregister(id);
    // `remove` is the NodeView's `deleteNode`, stable for the node's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broken, id, key]);
}

/** Editor side: how many broken references this editor shows, and a remover. */
export function useBrokenRefs(editor: Editor | null): { count: number; removeAll: () => void } {
  const key = editor ? editorKey(editor) : null;
  const count = useBrokenRefsStore((s) =>
    key ? Object.values(s.entries).filter((e) => e.editorKey === key).length : 0,
  );
  const removeAll = () => {
    if (!key) return;
    const mine = Object.entries(useBrokenRefsStore.getState().entries).filter(
      ([, e]) => e.editorKey === key,
    );
    // Each NodeView's `deleteNode` reads its position at call time, so removing
    // one does not invalidate the next.
    for (const [id, e] of mine) {
      useBrokenRefsStore.getState().unregister(id);
      e.remove();
    }
  };
  return { count, removeAll };
}
