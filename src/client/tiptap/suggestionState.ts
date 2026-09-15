import type { EditorView } from '@tiptap/pm/view';

/**
 * Is any `@tiptap/suggestion` popup (the `/` palette, an `@` mention list)
 * SHOWING in this editor, with something to pick?
 *
 * A host that registers its own `editorProps.handleKeyDown` must consult
 * this: ProseMirror runs DIRECT view props before plugin props, so an
 * unconditional Enter handler would fire before the popup could select its
 * item — the chat composer used to submit a half-typed `/sec` as a message.
 *
 * Tracked by the popups themselves, not read off the plugin state: the
 * plugin's `active` flag follows the TEXT before the caret, not what is on
 * screen. It stays set after Escape closed the palette (Enter then ran the
 * hidden palette's selection instead of submitting) and while a `/word` or
 * `@word` matches nothing (Enter was swallowed, or inserted a newline). A
 * popup with no items is not "open" here either — Enter has nothing to pick.
 */
const openPopups = new WeakMap<EditorView, Set<string>>();

export function setSuggestionPopupOpen(view: EditorView, key: string, open: boolean): void {
  let set = openPopups.get(view);
  if (!set) {
    if (!open) return;
    set = new Set();
    openPopups.set(view, set);
  }
  if (open) set.add(key);
  else set.delete(key);
}

export function isSuggestionActive(view: EditorView): boolean {
  return (openPopups.get(view)?.size ?? 0) > 0;
}
