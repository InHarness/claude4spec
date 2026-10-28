import { useEffect } from 'react';
import { useConfig } from '../../hooks/useConfig.js';
import { SettingsCardFrame } from './SettingsCardFrame.js';
import { assembleSettings, type AssembledCard, type SettingsContribution, type SettingsScope } from './registry.js';
import { SETTINGS_MODULE_CARDS } from './cards/settingsModuleCards.js';
import { REMOTE_ACCOUNT_SETTINGS } from '../account/UserCardElement.js';
import { APPEARANCE_SETTINGS } from '../shell/AppearanceElement.js';
import { PROJECT_SETTINGS } from '../project/projectSettings.js';
import { WRITING_STYLE_SETTINGS } from '../writing-styles/writingStyleSettings.js';
import { GIT_SETTINGS } from '../git/gitSettings.js';
import { EXTERNAL_INTEGRATIONS_SETTINGS } from '../external-integrations/ExternalIntegrationsElements.js';
import { WORKSPACE_SETTINGS } from '../workspace/DangerZoneElement.js';
import { AGENT_SETTINGS } from '../../chat/settings/agentSettings.js';
import { SPEC_SKILLS_SETTINGS } from '../spec-skills/specSkillsSettings.js';
import { PLUGIN_HOST_SETTINGS } from '../../core/plugin-host/pluginSettings.js';

/**
 * 0.2.113 — every module that declares something on a settings page. The order
 * here is irrelevant: a page orders by group → card weight → element weight.
 *
 * 2.1.21 (M26 `7f76eszm`): this list IS the card and element registry — the
 * layer's `Karty`/`Elementy` tables plus the implementor's own cards (About,
 * Index status). No cards are generated for plugins. 2.1.58: one registry, two
 * pages — each card's scope picks the project or the workspace settings page.
 *
 * 2.1.50: a function, not a module-level array. `pluginSettings.ts` reaches
 * this module back through `runtime/boot-plugins.ts` → `tiptap/mountFrontend.ts`
 * → `router.tsx`, so when the graph is entered from that side (a test importing
 * `pluginSettings.ts` first) an array literal built at load would capture
 * `PLUGIN_HOST_SETTINGS` as `undefined`. Read at call time, every binding is live.
 */
export function staticSettingsContributions(): SettingsContribution[] {
  return [
    REMOTE_ACCOUNT_SETTINGS,
    APPEARANCE_SETTINGS,
    PROJECT_SETTINGS,
    WRITING_STYLE_SETTINGS,
    GIT_SETTINGS,
    PLUGIN_HOST_SETTINGS,
    EXTERNAL_INTEGRATIONS_SETTINGS,
    AGENT_SETTINGS,
    SPEC_SKILLS_SETTINGS,
    SETTINGS_MODULE_CARDS,
    WORKSPACE_SETTINGS,
  ];
}

// Each page assembled once, on its first render (not at module load — see
// `staticSettingsContributions`). A collision among the declarants is still a
// registration error that fails loudly; `catalog.test.ts` assembles the same list.
const assembled: Partial<Record<SettingsScope, AssembledCard[]>> = {};
export function settingsCards(scope: SettingsScope): AssembledCard[] {
  return (assembled[scope] ??= assembleSettings(staticSettingsContributions(), scope));
}

/**
 * The page's one hash parameter, `#<card anchor>`: smooth-scroll to that card,
 * on landing and on every hash change. `ready` re-runs it once the cards exist
 * (a hard load of the project page lands before the config does).
 */
export function useScrollToCardHash(ready: unknown): void {
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
  }, [ready]);
}

/**
 * M26 → 0.2.113 — the PROJECT settings page at `/settings`, ASSEMBLED from the
 * declared cards and elements of scope `project` (2.1.58: a `workspace` card
 * never renders here — it stands on `/workspace/settings`). One generic hash
 * parameter, `#<card anchor>`, smooth-scrolls to that card.
 */
export function SettingsPage() {
  const { data: config } = useConfig();

  const visibleCards = config ? settingsCards('project').filter((c) => !c.decl.visible || c.decl.visible(config)) : [];

  useScrollToCardHash(visibleCards.length);

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
