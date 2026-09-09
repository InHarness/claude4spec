import { describe, expect, it } from 'vitest';
import { deleteUiViewBody } from '../src/entity/ui-view/frontend/delete-confirm.js';

/**
 * 0.2.78 — the delete confirmation's wording is a CONTRACT, not decoration.
 *
 * It is the only thing a reader is given to decide an irreversible act with, and
 * three surfaces now raise it (chip, card, detail panel). Asserting the sentence
 * is how the three stay identical; asserting the zero case is how the count
 * stays meaningful.
 */
describe('deleteUiViewBody', () => {
  it('always says the delete cannot be undone', () => {
    expect(deleteUiViewBody('Login', 0)).toBe('Delete UI view "Login"? This cannot be undone.');
    expect(deleteUiViewBody('Login', 3)).toContain('This cannot be undone.');
  });

  it('appends the reference warning, rather than replacing the irreversibility notice', () => {
    /**
     * The bug this pins. The panel used to choose ONE of the two sentences, so
     * the more dangerous case — a view several pages cite — was the one that
     * lost "this cannot be undone". The warning is additive.
     */
    expect(deleteUiViewBody('Login', 3)).toBe(
      'Delete UI view "Login"? This cannot be undone. 3 pages reference this view and will become broken.',
    );
  });

  it('drops the sentence entirely at zero, instead of warning about nothing', () => {
    // "0 pages reference this view and will become broken" is noise that teaches
    // the reader to skip the line, which is exactly the line that matters when
    // it is not zero.
    expect(deleteUiViewBody('Login', 0)).not.toContain('reference this view');
  });

  it('agrees the verb with the count', () => {
    expect(deleteUiViewBody('Login', 1)).toContain('1 page reference');
    expect(deleteUiViewBody('Login', 2)).toContain('2 pages reference');
  });
});
