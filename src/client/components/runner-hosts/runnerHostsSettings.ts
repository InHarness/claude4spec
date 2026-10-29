import { EFFECT, type SettingsContribution } from '../settings/registry.js';
import { RunnerHostsElement } from './RunnerHostsElement.js';

/**
 * 2.1.62 (M54 L17 `cx6b7xjn`) — the `Runner hosts` card: group Integrations,
 * weight 10, scope `workspace`, so it stands on `/workspace/settings` and never
 * on a project's `/settings`. Its one element, `Runner host list`, is the
 * module's own component; its value lives outside the config file (the records
 * in the workspace registry entry), and a change applies immediately.
 */
export const RUNNER_HOSTS_SETTINGS: SettingsContribution = {
  cards: [
    {
      anchor: 'runner-hosts',
      title: 'Runner hosts',
      group: 'Integrations',
      weight: 10,
      owner: 'runner-hosts',
      scope: 'workspace',
    },
  ],
  elements: [
    {
      id: 'runner-host-list',
      card: 'runner-hosts',
      weight: 10,
      kind: 'custom',
      owner: 'runner-hosts',
      label: 'Runner host list',
      effectMessage: EFFECT.immediate,
      component: RunnerHostsElement,
    },
  ],
};
