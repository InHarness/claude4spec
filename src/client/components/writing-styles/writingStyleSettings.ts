import { useWritingStyles } from '../../hooks/useWritingStyles.js';
import { EFFECT, type SettingsContribution } from '../settings/registry.js';

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
          label: `${s.title}${s.source === 'user' ? ' — yours' : ' — plugin'}`,
        })),
      validate: (_value, { config }) =>
        config.writingStyleUnavailable ? { warning: `The saved style is unavailable: ${config.writingStyleUnavailable.reason}` } : null,
    },
  ],
};
