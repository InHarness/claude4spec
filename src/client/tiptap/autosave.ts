/**
 * L8 save policy for the `page` context and the surfaces that reuse its editor
 * (briefs, patches — spec M21 `m21detai`: "reuse `Editor.tsx` from M02").
 *
 * The number lives on the context spec since the spec became the authority on
 * save policy (M20 `ctx4prof`, rule 4); this re-export keeps the import path.
 */
export { AUTOSAVE_DEBOUNCE_MS } from './contextSpec.js';
