import type { EditorState } from '@tiptap/pm/state';

/**
 * Is any `@tiptap/suggestion` popup (the `/` palette, an `@` mention list)
 * open in this editor? Every suggestion plugin in the app keys itself
 * `c4s-suggestion-*`; its state carries `active`.
 *
 * A host that registers its own `editorProps.handleKeyDown` must consult
 * this: ProseMirror runs DIRECT view props before plugin props, so an
 * unconditional Enter handler would fire before the popup could select its
 * item — the chat composer used to submit a half-typed `/sec` as a message.
 */
export function isSuggestionActive(state: EditorState): boolean {
  for (const plugin of state.plugins) {
    const key = (plugin.spec.key as { key?: string } | undefined)?.key;
    if (!key || !key.startsWith('c4s-suggestion-')) continue;
    if ((plugin.getState(state) as { active?: boolean } | undefined)?.active) return true;
  }
  return false;
}
