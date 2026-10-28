import { PROJECT_ID } from '../../lib/api-core.js';
import { useConfig } from '../../hooks/useConfig.js';
import { useWorkspace } from '../../hooks/useWorkspace.js';
import type { WorkspaceResponse } from '../../lib/workspace.js';
import { confirmDestructive, toast } from '../../ui/events.js';
import { navigateDocument } from '../../lib/document-nav.js';
import type { SettingsContribution } from '../settings/registry.js';

interface DeleteResponse {
  redirectProjectId: string | null;
}

/**
 * M31 `m31l5001` Okna — the `project-detach` text depends on the workspace's
 * kind: a registry workspace keeps the slot on disk; a workspace with a home
 * directory drops the project from the committed `workspace.json`.
 */
function detachBody(projectName: string, kind: WorkspaceResponse['kind']): string {
  if (kind === 'home') {
    return (
      `Detach ${projectName} from the workspace? The project leaves workspace.json — once committed, ` +
      'it disappears for everyone working on this repository. Restore it with git or by adding the project again.'
    );
  }
  return (
    `Detach ${projectName} from the workspace? c4s data (index, chats, plans, releases) ` +
    'stays on disk — registering the same directory again restores it.'
  );
}

/**
 * M26 / M31 §1 — Danger zone. The last Settings section. Two ways to remove the
 * project from the workspace, both consuming `DELETE /api/workspace/projects/:id`:
 *
 *  - Detach (purgeData=false): the DB slot stays on disk — re-registering the
 *    same cwd restores the index + runtime.
 *  - Purge (purgeData=true): rm -rf the slot dir too — index AND runtime
 *    (chats/plans/releases/sessions) are gone for good. Nothing in `cwd` is
 *    ever touched. Guarded by type-to-confirm on the exact project name.
 *
 * Workspace-scope call → plain `fetch` (not project-prefixed `apiFetch`). On
 * success a full reload to `/p/<redirectProjectId>/` (or `/` when the last
 * project was removed — the server resolves `/` to `/welcome`) re-initializes
 * the module-load constants.
 */
/**
 * 0.2.113 — the workspace module's card. Both actions call
 * `DELETE /api/workspace/projects/:id` and differ in `purgeData`; a
 * `409 PROJECT_BUSY` leaves the dialog open with an error toast.
 */
export const WORKSPACE_SETTINGS: SettingsContribution = {
  cards: [
    {
      anchor: 'danger-zone',
      title: 'Danger zone',
      description: 'Remove this project from the workspace. Neither action deletes anything in the project directory.',
      group: 'System',
      weight: 90,
      owner: 'workspace',
      scope: 'project',
      tone: 'danger',
    },
  ],
  elements: [
    {
      id: 'remove-project',
      card: 'danger-zone',
      weight: 10,
      kind: 'custom',
      owner: 'workspace',
      component: DangerZoneElement,
    },
  ],
};

export function DangerZoneElement() {
  const { data: config } = useConfig();
  const { data: workspace } = useWorkspace();
  const projectName = config?.name ?? '';

  /** `true` = removed (navigating away); `false` = refused, the dialog stays open. */
  async function remove(purge: boolean): Promise<boolean> {
    try {
      const res = await fetch(
        `/api/workspace/projects/${PROJECT_ID}?purgeData=${purge}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string; message?: string } }
          | null;
        // Purge refused by an in-flight turn: error toast, the dialog stays open
        // and the db slot is untouched (M31 `h23797ko`).
        if (body?.error?.code === 'PROJECT_BUSY') {
          toast.error('Project is busy — finish the running turn first');
        } else {
          toast.error(body?.error?.message ?? 'Failed to remove project');
        }
        return false;
      }
      const { redirectProjectId } = (await res.json()) as DeleteResponse;
      // A full load: every workspace and project list is fetched afresh there.
      // `null` = the last project was removed → `/`, which the server 302s to
      // `/welcome` (M31 `eb95ery1`).
      navigateDocument(redirectProjectId ? `/p/${redirectProjectId}/` : '/');
      return true;
    } catch {
      toast.error('Failed to remove project');
      return false;
    }
  }

  async function handleDetach(): Promise<void> {
    if (!workspace) return;
    await confirmDestructive('project-detach', {
      action: () => remove(false),
      title: 'Detach project',
      body: detachBody(projectName, workspace.kind),
      confirmLabel: 'Detach',
      danger: false,
    });
  }

  async function handlePurge(): Promise<void> {
    await confirmDestructive('project-purge', {
      action: () => remove(true),
      title: 'Delete project & c4s data',
      body:
        'Chats, plans, releases and sessions of this project will be lost permanently. ' +
        'config.json, pages (pages/) and entities in the project directory stay untouched — ' +
        'registering it again recreates the project with an empty runtime and a fresh index.',
      requireText: projectName,
      confirmLabel: 'Delete data',
      danger: true,
    });
  }

  return (
    <div>
      <div className="flex flex-col gap-4">
        <Row
          title="Detach project"
          desc="Remove it from the workspace but keep its c4s data on disk. Re-registering the same directory restores it."
        >
          <button
            type="button"
            disabled={!config || !workspace}
            onClick={() => void handleDetach()}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
            style={{ border: '1px solid var(--c-hair-strong)', color: 'var(--c-ink)' }}
          >
            Detach project
          </button>
        </Row>

        <div style={{ borderTop: '1px solid var(--c-hair)' }} />

        <Row
          title="Delete project and c4s data"
          desc="Permanently delete the entity index, chats, plans, releases, and sessions. Irreversible. Files in the project directory are untouched."
        >
          <button
            type="button"
            disabled={!config}
            onClick={() => void handlePurge()}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
            style={{ background: 'var(--c-red, #c45a3b)', color: '#fff' }}
          >
            Delete project and c4s data
          </button>
        </Row>
      </div>
    </div>
  );
}

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
          {title}
        </div>
        <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--c-subtle)' }}>
          {desc}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
