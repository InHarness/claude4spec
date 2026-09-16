import { describe, expect, it } from 'vitest';
import type { EditorView } from '@tiptap/pm/view';
import { isSuggestionActive, setSuggestionPopupOpen } from './suggestionState.js';

const view = () => ({}) as unknown as EditorView;

describe('isSuggestionActive', () => {
  it('is false for an editor no popup has reported on', () => {
    expect(isSuggestionActive(view())).toBe(false);
  });

  it('follows what the popups report, per editor', () => {
    const a = view();
    const b = view();
    setSuggestionPopupOpen(a, 'slash', true);
    expect(isSuggestionActive(a)).toBe(true);
    expect(isSuggestionActive(b)).toBe(false);
    setSuggestionPopupOpen(a, 'slash', false);
    expect(isSuggestionActive(a)).toBe(false);
  });

  it('stays active while ANY popup of the editor is open', () => {
    const v = view();
    setSuggestionPopupOpen(v, 'slash', true);
    setSuggestionPopupOpen(v, 'mention:files', true);
    setSuggestionPopupOpen(v, 'slash', false);
    expect(isSuggestionActive(v)).toBe(true);
    setSuggestionPopupOpen(v, 'mention:files', false);
    expect(isSuggestionActive(v)).toBe(false);
  });

  it('closing a popup that never opened is a no-op', () => {
    const v = view();
    setSuggestionPopupOpen(v, 'slash', false);
    expect(isSuggestionActive(v)).toBe(false);
  });
});
