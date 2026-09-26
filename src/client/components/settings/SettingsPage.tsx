import { useEffect, useMemo } from 'react';
import { useConfig } from '../../hooks/useConfig.js';
import { SettingsCardFrame } from './SettingsCardFrame.js';
import { assembleSettings, type AssembledCard, type SettingsContribution } from './registry.js';
import { SETTINGS_MODULE_CARDS } from './cards/settingsModuleCards.js';
import { REMOTE_ACCOUNT_SETTINGS } from '../account/UserCardElement.js';
import { APPEARANCE_SETTINGS } from '../shell/AppearanceElement.js';
import { PROJECT_SETTINGS, ARTIFACT_DIR_ELEMENTS } from '../project/projectSettings.js';
import { WRITING_STYLE_SETTINGS } from '../writing-styles/writingStyleSettings.js';
import { RELEASE_PUSH_SETTINGS } from '../release/RemoteProjectElement.js';
import { GIT_SETTINGS } from '../git/gitSettings.js';
import { EXTERNAL_INTEGRATIONS_SETTINGS } from '../external-integrations/ExternalIntegrationsElements.js';
import { WORKSPACE_SETTINGS } from '../workspace/DangerZoneElement.js';
import { AGENT_SETTINGS } from '../../chat/settings/agentSettings.js';
import { PLUGIN_HOST_SETTINGS, usePluginSettingsContribution } from '../../core/plugin-host/pluginSettings.js';

/**
 * 0.2.113 — every module that declares something on `/settings`. The order here
 * is irrelevant: the page orders by group → card weight → element weight.
 */
export const STATIC_SETTINGS_CONTRIBUTIONS: SettingsContribution[] = [
  REMOTE_ACCOUNT_SETTINGS,
  APPEARANCE_SETTINGS,
  PROJECT_SETTINGS,
  ARTIFACT_DIR_ELEMENTS,
  WRITING_STYLE_SETTINGS,
  RELEASE_PUSH_SETTINGS,
  GIT_SETTINGS,
  PLUGIN_HOST_SETTINGS,
  EXTERNAL_INTEGRATIONS_SETTINGS,
  AGENT_SETTINGS,
  SETTINGS_MODULE_CARDS,
  WORKSPACE_SETTINGS,
];

// Assembled once at module load: a collision among the static declarants is a
// registration error, and it fails loudly here rather than on some later render.
const STATIC_ANCHORS = new Set(assembleSettings(STATIC_SETTINGS_CONTRIBUTIONS).map((c) => c.decl.anchor));

/**
 * M26 → 0.2.113 — the full-page Settings surface at `/settings`, ASSEMBLED from
 * the declared cards and elements. One generic hash parameter, `#<card anchor>`,
 * smooth-scrolls to that card (plugin cards answer to `#plugin-<name>`).
 */
export function SettingsPage() {
  const { data: config } = useConfig();
  const pluginContribution = usePluginSettingsContribution();

  const cards: AssembledCard[] = useMemo(() => {
    // A plugin card whose anchor a core card already holds cannot be registered;
    // it is left out rather than taking the page down with it.
    const pluginCards = (pluginContribution.cards ?? []).filter((c) => {
      if (!STATIC_ANCHORS.has(c.anchor)) return true;
      console.warn(`[settings] plugin card "#${c.anchor}" collides with a core card and is not shown`);
      return false;
    });
    return assembleSettings([
      ...STATIC_SETTINGS_CONTRIBUTIONS,
      { cards: pluginCards, elements: pluginContribution.elements ?? [] },
    ]);
  }, [pluginContribution]);

  const visibleCards = config ? cards.filter((c) => !c.decl.visible || c.decl.visible(config)) : [];

  useEffect(() => {
    const scrollToHash = () => {
      const hash = window.location.hash.replace(/^#/, '');
      if (!hash) return;
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    scrollToHash();
    window.addEventListener('hashchange', scrollToHash);
    return () => window.removeEventListener('hashchange', scrollToHash);
    // Re-run once the cards exist: a hard load lands here before the config does.
  }, [visibleCards.length]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: 'var(--c-bg)' }}>
      <div className="mx-auto py-10 px-6" style={{ maxWidth: 720 }}>
        <h1 className="text-[22px] font-semibold mb-6" style={{ color: 'var(--c-ink)' }}>
          Settings
        </h1>
        <div className="flex flex-col gap-6">
          {config
            ? visibleCards.map((card) => <SettingsCardFrame key={card.decl.anchor} card={card} config={config} />)
            : null}
        </div>
      </div>
    </div>
  );
}
