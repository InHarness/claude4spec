import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { metaApi } from '../../lib/api.js';
import { refreshPluginActivation } from '../../runtime/boot-plugins.js';
import { clientPluginHost } from './host.js';
import { PluginPoolElement } from './PluginPoolElement.js';
import { ELEMENTS_MENU_KEY, SIDEBAR_MENU_HELP, SidebarMenuElement } from './SidebarMenuElement.js';
import { EFFECT, type SettingsContribution } from '../../components/settings/registry.js';

/**
 * 0.2.113 — what the plugin host declares on `/settings`. Two separate things,
 * kept apart on purpose:
 *
 *  - axis A — which entity types are ACTIVE in this project (`entities`), edited
 *    on the Entities card;
 *  - axis B — what the pool CONTAINS (`base ∪ overlay`), shown read-only on the
 *    Plugin pool card.
 *
 * 2.1.21 (M26 `7f76eszm`): there are no generated per-plugin settings cards —
 * plugins contribute no settings fields or elements to the page.
 */
export const PLUGIN_HOST_SETTINGS: SettingsContribution = {
  cards: [
    {
      anchor: 'entities',
      title: 'Entities',
      description:
        'Which entity types are active in this project. This edits activation only — see Plugin pool for what is available.',
      // The spec gives this card no group; it orders with the Project cards.
      group: 'Project',
      weight: 50,
      owner: 'entity-framework',
    },
    {
      anchor: 'plugin-pool',
      title: 'Plugin pool',
      description:
        'What entity types and plugins are available to this project (base ∪ overlay). Read-only — the pool changes with the workspace switch (base) or in the project repository (overlay).',
      group: 'Plugins',
      weight: 10,
      owner: 'plugin-loader',
    },
  ],
  elements: [
    {
      id: 'entity-types',
      card: 'entities',
      weight: 10,
      kind: 'multiselect',
      owner: 'entity-framework',
      configKey: ['entities'],
      label: 'Entity types',
      // No key in the file = every type active.
      allWhenAbsent: true,
      effectMessage: EFFECT.rebuild,
      useOptions: useEntityTypeOptions,
      /**
       * Activation decides routes as well as the sidebar: re-apply it live and
       * rebuild the plugin routes, or a re-activated type would get its tab back
       * while its route stays absent until a reload. 2.1.16 (M50 `8h2a734u`):
       * the ELEMENTS tabs follow in this tab, with no page reload and no server
       * restart — `[]` leaves the "No entity types configured." message.
       */
      afterSave: async ({ router, queryClient }) => {
        try {
          await refreshPluginActivation(router);
          await queryClient.invalidateQueries();
        } catch {
          window.location.reload();
        }
      },
    },
    {
      // 2.1.50 (M13 `4ckqwi8t`, `lbqrd6xh`): the ELEMENTS layout editor, saved
      // with the card's shared [Save]. The sidebar follows the save at once —
      // `usePatchConfig` replaces the page's layout seed.
      id: 'sidebar-menu',
      card: 'entities',
      weight: 20,
      kind: 'custom',
      owner: 'entity-framework',
      keys: [ELEMENTS_MENU_KEY],
      label: 'Sidebar menu',
      help: SIDEBAR_MENU_HELP,
      effectMessage: EFFECT.immediate,
      component: SidebarMenuElement,
    },
    {
      id: 'plugin-pool',
      card: 'plugin-pool',
      weight: 10,
      kind: 'custom',
      owner: 'plugin-loader',
      component: PluginPoolElement,
    },
  ],
};

/** The effective pool (`active ∪ inactive` from `GET /api/meta/entities`), by type. */
function useEntityTypeOptions() {
  const { data } = useQuery({ queryKey: ['meta-entities'], queryFn: () => metaApi.entities() });
  return useMemo(() => {
    if (!data) return undefined;
    return [...data.active, ...data.inactive]
      .sort((a, b) => a.localeCompare(b))
      .map((type) => {
        const m = clientPluginHost.getAvailable(type);
        return { value: type, label: `${m?.labelPlural ?? m?.label ?? type}${m ? '' : ' (overlay)'}` };
      });
  }, [data]);
}
