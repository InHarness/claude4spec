import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { metaApi } from '../../lib/api.js';
import { mountFrontend } from '../../tiptap/mountFrontend.js';
import { clientPluginHost } from './host.js';
import { PluginPoolElement } from './PluginPoolElement.js';
import type { PluginSettingField } from '../../../shared/plugin-host/manifest.js';
import {
  EFFECT,
  type ElementKind,
  type SettingsContribution,
  type SettingsElementDecl,
} from '../../components/settings/registry.js';

/**
 * 0.2.113 — what the plugin host declares on `/settings`. Three separate things,
 * kept apart on purpose:
 *
 *  - axis A — which entity types are ACTIVE in this project (`entities`), edited
 *    on the Entities card;
 *  - axis B — what the pool CONTAINS (`base ∪ overlay`), shown read-only on the
 *    Plugin pool card;
 *  - each plugin's own settings — a card per plugin, generated from its
 *    `PluginSettingField`s.
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
       * while its route stays absent until a reload.
       */
      afterSave: async ({ router, queryClient }) => {
        try {
          clientPluginHost.applyActivation(await metaApi.entities());
          mountFrontend(router, clientPluginHost.listEntities());
          await queryClient.invalidateQueries();
        } catch {
          window.location.reload();
        }
      },
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

/** The effective pool (`active ∪ inactive` from `GET /api/meta/entities`), in display order. */
function useEntityTypeOptions() {
  const { data } = useQuery({ queryKey: ['meta-entities'], queryFn: () => metaApi.entities() });
  return useMemo(() => {
    if (!data) return undefined;
    return [...data.active, ...data.inactive]
      .sort((a, b) => {
        const oa = clientPluginHost.getAvailable(a)?.displayOrder ?? 9999;
        const ob = clientPluginHost.getAvailable(b)?.displayOrder ?? 9999;
        return oa - ob || a.localeCompare(b);
      })
      .map((type) => {
        const m = clientPluginHost.getAvailable(type);
        return { value: type, label: `${m?.labelPlural ?? m?.label ?? type}${m ? '' : ' (overlay)'}` };
      });
  }, [data]);
}

const CONTROL_KIND: Record<PluginSettingField['control'], ElementKind> = {
  toggle: 'toggle',
  text: 'text',
  select: 'select',
  multiselect: 'multiselect',
};

/** `#plugin-<name>` — the package name made kebab (`@c4s/plugin-foo` → `plugin-c4s-plugin-foo`). */
export function pluginCardAnchor(name: string): string {
  return `plugin-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

/**
 * One card per loaded + trusted plugin that declares settings — title
 * `manifest.name`, the version in the description, weight 100 (ties broken by
 * title, i.e. alphabetically). Validation is the type alone; a save deep-merges
 * under `plugins.<name>`. An inactive plugin declares nothing and loses its card,
 * but its values stay in the file.
 */
export function usePluginSettingsContribution(): SettingsContribution {
  const { data: sections } = useQuery({
    queryKey: ['plugin-settings'],
    queryFn: () => metaApi.pluginSettings().then((r) => r.sections),
  });
  return useMemo(() => {
    if (!sections) return {};
    return {
      cards: sections.map((s) => ({
        anchor: pluginCardAnchor(s.name),
        title: s.name,
        description: `Settings contributed by ${s.name} v${s.version}.`,
        group: 'Plugins' as const,
        weight: 100,
        owner: s.name,
      })),
      elements: sections.flatMap((s) =>
        s.fields.map(
          (f, i): SettingsElementDecl => ({
            id: f.key,
            card: pluginCardAnchor(s.name),
            weight: (i + 1) * 10,
            kind: CONTROL_KIND[f.control],
            owner: s.name,
            configKey: ['plugins', s.name, f.key],
            label: f.label,
            help: f.help,
            baseline: (config) => config.plugins?.[s.name]?.[f.key] ?? f.default,
            // `executive` rebuilds the context; `hot-reload` gets the plain toast.
            ...(f.kind === 'executive' ? { effectMessage: EFFECT.rebuild } : {}),
            ...(f.options ? { useOptions: () => f.options } : {}),
          }),
        ),
      ),
    };
  }, [sections]);
}
