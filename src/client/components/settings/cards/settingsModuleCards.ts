import type { SettingsContribution } from '../registry.js';
import { AboutElement } from './AboutElement.js';
import { IndexStatusElement } from './IndexStatusElement.js';

/**
 * 0.2.113 — the only cards the settings module still owns: About and Index
 * status. Everything else on `/settings` is declared by the module it belongs to.
 * Index status renders always, fresh projections included.
 */
export const SETTINGS_MODULE_CARDS: SettingsContribution = {
  cards: [
    {
      anchor: 'about',
      title: 'About',
      description: 'Build metadata for support and troubleshooting.',
      group: 'System',
      weight: 10,
      owner: 'settings',
    },
    {
      anchor: 'index-status',
      title: 'Index status',
      description:
        'The state of every projection in this project — fresh, stale or not built — with the time it was last recomputed.',
      group: 'System',
      weight: 20,
      owner: 'settings',
    },
  ],
  elements: [
    { id: 'about', card: 'about', weight: 10, kind: 'custom', owner: 'settings', component: AboutElement },
    {
      id: 'index-status',
      card: 'index-status',
      weight: 10,
      kind: 'custom',
      owner: 'settings',
      component: IndexStatusElement,
    },
  ],
};
