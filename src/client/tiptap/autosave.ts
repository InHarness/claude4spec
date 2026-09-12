/**
 * L8 save policy for the `page` context and the surfaces that reuse its editor
 * (briefs, patches — spec M21 `m21detai`: "reuse `Editor.tsx` from M02").
 *
 * One number on purpose. The M20 race analysis (`m20edge0`) pairs a 1000 ms
 * autosave debounce with the 500 ms WS invalidation batch; briefs and patches
 * inherit the value through the component they reuse rather than declaring
 * their own. Candidate for a per-project `autoSaveDebounceMs` later; a constant
 * for now.
 */
export const AUTOSAVE_DEBOUNCE_MS = 1000;
