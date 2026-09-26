import type { FieldDeclaration } from '../settings/field-registry.js';

/**
 * 0.2.113 — `writingStyle`, declared by the writing-styles module.
 *
 * `new-thread`, not `per-turn`: the style is settled on a thread's FIRST turn and a
 * running or resumed thread keeps the `<project_writing_skill/>` block it started
 * with. Unlike the path scope it does not lock a resume — the thread simply keeps
 * its style (see `resolveThreadPromptConfig`).
 */
export const WRITING_STYLE_SETTINGS_FIELDS: FieldDeclaration[] = [
  {
    key: 'writingStyle',
    owner: 'writing-styles',
    type: 'string|null',
    default: null,
    // `null`, or a slug `listSelectable()` offers at the moment of the write.
    validate: (value, ctx) =>
      typeof value === 'string' && !ctx.skillRegistry.isSelectable(value)
        ? { ok: false, error: `writingStyle "${value}" ${ctx.skillRegistry.unselectableReason(value)}` }
        : { ok: true },
    effect: 'new-thread',
    resumeLock: false,
    apiWritable: true,
  },
];
