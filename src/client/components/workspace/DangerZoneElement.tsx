import { PROJECT_ID } from '../../lib/api-core.js';
import { useConfig } from '../../hooks/useConfig.js';
import { confirmDestructive, toast } from '../../ui/events.js';
import type { SettingsContribution } from '../settings/registry.js';

interface DeleteResponse {
  redirectProjectId: string | null;
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

function DangerZoneElement() {
  const { data: config } = useConfig();
  const projectName = config?.name ?? '';

  /** `true` = removed (navigating away); `false` = refused, the dialog stays open. */
  async function remove(purge: boolean): Promise<boolean> {
    try {
      const res = await fetch(
        `/api/workspace/projects/${PROJECT_ID}?purgeData=${purge}`,
        { method: 'DELETE' },
      );
      if (res.status === 409) {
        toast.error('Project busy — finish the in-flight turn first');
        return false;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        toast.error(body?.error?.message ?? 'Failed to remove project');
        return false;
      }
      const { redirectProjectId } = (await res.json()) as DeleteResponse;
      // A full load: every workspace and project list is fetched afresh there.
      window.location.href = redirectProjectId ? `/p/${redirectProjectId}/` : '/';
      return true;
    } catch {
      toast.error('Failed to remove project');
      return false;
    }
  }

  async function handleDetach(): Promise<void> {
    await confirmDestructive('project-detach', {
      action: () => remove(false),
      title: 'Detach project',
      body:
        `Detach “${projectName}” from this workspace?\n\n` +
        'Your c4s data (entity index, chats, plans, releases) stays on disk — ' +
        're-registering the same directory restores it.',
      confirmLabel: 'Detach',
      danger: false,
    });
  }

  async function handlePurge(): Promise<void> {
    await confirmDestructive('project-purge', {
      action: () => remove(true),
      title: 'Delete project & c4s data',
      body:
        `This permanently deletes “${projectName}”’s c4s data — the entity index, ` +
        'chats, plans, releases, and sessions are gone for good and cannot be recovered.\n\n' +
        'Nothing in the project directory is touched: config.json, pages, and entity ' +
        'files stay.\n\nType the project name to confirm.',
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
            disabled={!config}
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
