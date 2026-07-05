import { useEffect } from 'react';
import { UserSettingsSection } from './sections/UserSettingsSection.js';
import { ProjectSection } from './sections/ProjectSection.js';
import { AppearanceSection } from './sections/AppearanceSection.js';
import { RemoteProjectSection } from './sections/RemoteProjectSection.js';
import { GitSection } from './sections/GitSection.js';
import { DirectoriesSection } from './sections/DirectoriesSection.js';
import { EntitiesSection } from './sections/EntitiesSection.js';
import { ExternalSkillsSection } from './sections/ExternalSkillsSection.js';
import { PluginPoolSection } from './sections/PluginPoolSection.js';
import { PluginSettingsSection } from './sections/PluginSettingsSection.js';
import { AgentSection } from './sections/AgentSection.js';
import { AboutSection } from './sections/AboutSection.js';
import { DangerZoneSection } from './sections/DangerZoneSection.js';

/**
 * M26 — full-page Settings surface mounted at `/settings`. Vertical stack of
 * sections in a 720px-wide column. Smooth-scroll to the hash anchor on mount
 * and on `hashchange`.
 *
 * Section ids match the anchors referenced from the rest of the app:
 *   user-section · project · appearance · remote-project · git · directories ·
 *   entities · external-skills · plugin-pool · agent · about · danger-zone.
 */
export function SettingsPage() {
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
  }, []);

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto"
      style={{ background: 'var(--c-bg)' }}
    >
      <div className="mx-auto py-10 px-6" style={{ maxWidth: 720 }}>
        <h1 className="text-[22px] font-semibold mb-6" style={{ color: 'var(--c-ink)' }}>
          Settings
        </h1>
        <div className="flex flex-col gap-6">
          <UserSettingsSection />
          <ProjectSection />
          <AppearanceSection />
          <RemoteProjectSection />
          <GitSection />
          <DirectoriesSection />
          <EntitiesSection />
          <ExternalSkillsSection />
          <PluginPoolSection />
          <PluginSettingsSection />
          <AgentSection />
          <AboutSection />
          <DangerZoneSection />
        </div>
      </div>
    </div>
  );
}
