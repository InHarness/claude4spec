import { useWritingStyles } from '../../hooks/useWritingStyles.js';
import { EFFECT, type SettingsContribution } from '../settings/registry.js';
import { writingStyleOptionLabel } from '../../../shared/writing-styles.js';

/**
 * 0.2.113 — the writing-styles module's element on the Project card. The choice
 * reaches the first turn of a NEW conversation; a running one keeps the style it
 * started with.
 */
export const WRITING_STYLE_SETTINGS: SettingsContribution = {
  elements: [
    {
      id: 'writing-style',
      card: 'project',
      weight: 40,
      kind: 'select',
      owner: 'writing-styles',
      configKey: ['writingStyle'],
      label: 'Writing style',
      nullOption: '(none — default tone)',
      help: 'The convention every piece of specification content in this project follows.',
      effectMessage: EFFECT.newThread,
      useOptions: () =>
        useWritingStyles().data?.available.map((s) => ({
          value: s.slug,
          // 2.1.9 (M15 L17 `m6ukdbsc`): a distinct badge per `source` value, not two.
          label: writingStyleOptionLabel(s),
        })),
      validate: (_value, { config }) =>
        config.writingStyleUnavailable ? { warning: `The saved style is unavailable: ${config.writingStyleUnavailable.reason}` } : null,
    },
  ],
};
