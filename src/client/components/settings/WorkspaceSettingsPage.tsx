import type { ComponentType } from 'react';
import { useWorkspace } from '../../hooks/useWorkspace.js';
import { SettingsCard } from './SettingsCard.js';
import { settingsCards, useScrollToCardHash } from './SettingsPage.js';
import type { AssembledCard, SettingsElementDecl } from './registry.js';

/**
 * 2.1.58 (M26 `m26route` / `7f76eszm` / `oqp0up79`, ui-view
 * `workspace-settings-page`) — the WORKSPACE settings page at
 * `/workspace/settings`: a workspace route, mounted outside the project prefix
 * in the workspace frame, opened without a project. It renders only the cards
 * of scope `workspace`, from the same registry as `/settings`, in group →
 * weight order; a `project` card never stands here.
 *
 * Every element of a workspace card is a module's own component writing no
 * config key (`assembleSettings` refuses anything else), so the page has no
 * config to read, no per-card draft and no [Save] at all. One hash parameter,
 * `#<card anchor>`, smooth-scrolls to that card. The workspace's name comes
 * from the shared workspace read (M31), the one the frame's header also uses.
 */
export function WorkspaceSettingsPage() {
  const { data: workspace } = useWorkspace();
  const cards = settingsCards('workspace');

  useScrollToCardHash(cards.length);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: 'var(--c-bg)' }}>
      <div className="mx-auto py-10 px-6" style={{ maxWidth: 720 }}>
        <h1 className="text-[22px] font-semibold" style={{ color: 'var(--c-ink)' }}>
          Workspace settings
        </h1>
        <p className="text-[12px] mt-1 mb-6" style={{ color: 'var(--c-subtle)' }} data-testid="workspace-settings-name">
          {workspace ? workspace.name : ' '}
        </p>
        <div className="flex flex-col gap-6">
          {cards.map((card) => (
            <WorkspaceSettingsCard key={card.decl.anchor} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkspaceSettingsCard({ card }: { card: AssembledCard }) {
  return (
    <SettingsCard id={card.decl.anchor} title={card.decl.title} description={card.decl.description} tone={card.decl.tone}>
      <div className="flex flex-col gap-4">
        {card.elements.map((e) => {
          // Own components that need no project config — checked at assembly.
          const Custom = e.component as ComponentType<{ decl: SettingsElementDecl }> | undefined;
          return Custom ? <Custom key={e.id} decl={e} /> : null;
        })}
      </div>
    </SettingsCard>
  );
}
