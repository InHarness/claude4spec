import { ArrowRight } from 'lucide-react';
import { Skeleton } from '../../ui/Skeleton.js';
import { useWorkspace } from '../../hooks/useWorkspace.js';

/**
 * M31 L5 Sloty — the `Nagłówek` slot entry of the WORKSPACE route (2.1.58):
 * the workspace's name and the "last opened project" entry. A click on the
 * entry loads that project's route (`/p/<id>/` — a document load, since the
 * project identity is injected into the document). The entry shows only when
 * the last opened project belongs to the workspace: the server answers
 * `lastOpenedProject: null` otherwise, and an id missing from the listing is
 * not offered either. The project route keeps the switcher (ASSUMPTION:dev-0701).
 */
export function WorkspaceHeaderEntry() {
  const { data: workspace } = useWorkspace();

  if (!workspace) {
    return (
      <div className="flex-1 min-w-0" data-testid="workspace-header-entry">
        <Skeleton width={120} height={11} />
      </div>
    );
  }

  const lastOpened =
    workspace.lastOpenedProject === null
      ? undefined
      : workspace.projects.find((p) => p.id === workspace.lastOpenedProject);

  return (
    <div className="flex-1 min-w-0 flex items-center gap-3" data-testid="workspace-header-entry">
      <span
        className="min-w-0 text-[13px] font-semibold tracking-tight truncate"
        title={`Workspace ${workspace.name}`}
      >
        {workspace.name}
      </span>
      {lastOpened ? (
        <a
          href={`/p/${lastOpened.id}/`}
          className="min-w-0 inline-flex items-center gap-1 text-[12px] truncate hover:underline"
          style={{ color: 'var(--c-muted)' }}
          title={lastOpened.cwd}
        >
          <span className="truncate">Last opened: {lastOpened.name}</span>
          <ArrowRight size={12} style={{ flexShrink: 0 }} />
        </a>
      ) : null}
    </div>
  );
}
