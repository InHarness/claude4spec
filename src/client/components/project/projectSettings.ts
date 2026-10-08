import { SUPPORTED_LANGUAGES } from '../../../shared/languages.js';
import { validateName } from '../onboarding/NameField.js';
import { EFFECT, type SettingsContribution } from '../settings/registry.js';
import { RootsElement } from './RootsElement.js';

/**
 * 0.2.113 — what the PROJECT module declares on `/settings`: the Project card
 * (identity: name, description, spec language) and the Directories card with its
 * Roots element — its ONLY element (2.1.8: the artifact directories are fixed
 * system roots, with no settings).
 */
export const PROJECT_SETTINGS: SettingsContribution = {
  cards: [
    {
      anchor: 'project',
      title: 'Project',
      description: 'Name shown in the sidebar and used as the remote project label on first push.',
      group: 'Project',
      weight: 10,
      owner: 'project',
    },
    {
      anchor: 'directories',
      title: 'Directories',
      description: 'The page roots of this project. Plans, briefs, patches, entities and releases live in fixed directories under .claude4spec/.',
      // The spec gives this card no group; it orders with the Project cards.
      group: 'Project',
      weight: 40,
      owner: 'project',
    },
  ],
  elements: [
    {
      id: 'name',
      card: 'project',
      weight: 10,
      kind: 'text',
      owner: 'project',
      configKey: ['name'],
      label: 'Name',
      maxLength: 80,
      help: '1–80 chars; any character except line breaks and control characters.',
      effectMessage: EFFECT.newThread,
      validate: (value) => {
        const err = validateName(typeof value === 'string' ? value : '');
        return err ? { error: err } : null;
      },
    },
    {
      id: 'description',
      card: 'project',
      weight: 20,
      kind: 'textarea',
      owner: 'project',
      configKey: ['description'],
      label: 'Description',
      maxLength: 200,
      emptyAsNull: true,
      placeholder: 'One-line elevator pitch for this specification…',
      help: 'Visible to agents of other workspace projects, to help them decide whom to consult.',
      effectMessage: EFFECT.newThread,
      validate: (value) =>
        typeof value === 'string' && value.length > 200 ? { error: 'At most 200 characters.' } : null,
    },
    {
      id: 'language',
      card: 'project',
      weight: 30,
      kind: 'select',
      owner: 'project',
      configKey: ['language'],
      label: 'Spec language',
      nullOption: 'None',
      help: 'The language the agent writes spec content in. Not the conversation language — set that on the Agent card.',
      effectMessage: EFFECT.newThread,
      useOptions: () => SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: l })),
    },
    {
      id: 'roots',
      card: 'directories',
      weight: 10,
      kind: 'custom',
      owner: 'project',
      keys: [['roots']],
      label: 'Roots',
      effectMessage: EFFECT.rebuild,
      component: RootsElement,
    },
  ],
};
