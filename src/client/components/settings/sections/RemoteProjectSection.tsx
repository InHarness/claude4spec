import { useNavigate } from '@tanstack/react-router';
import { useRemoteProject } from '../../../hooks/useRemoteProject.js';
import { usePatchConfig } from '../../../hooks/useConfig.js';
import { ApiError } from '../../../lib/api.js';
import { confirmDestructive, toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';

/**
 * M26 §4 — Remote project section. Four mutually exclusive states surfaced
 * by `useRemoteProject` (brief §5 table):
 *   - not linked          → empty state.
 *   - linked, no auth     → empty state + nudge to log in.
 *   - linked, fetched     → card with name/createdAt + Disconnect.
 *   - linked, not_found   → card with warning banner + Disconnect suggestion.
 *
 * Disconnect mutates `config.remoteProjectId = null`; the next push becomes
 * a first push and creates a fresh remote project from `config.name`.
 */
export function RemoteProjectSection() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useRemoteProject();
  const patch = usePatchConfig();

  async function handleDisconnect() {
    const ok = await confirmDestructive({
      title: 'Disconnect from remote project?',
      body: 'The local config will be cleared. Your next push will create a new remote project.',
      confirmLabel: 'Disconnect',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      await patch.mutateAsync({ remoteProjectId: null });
      toast.success('Disconnected from remote project');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Disconnect failed');
    }
  }

  return (
    <SettingsCard
      id="remote-project"
      title="Remote project"
      description="Information about the project this workspace publishes to."
    >
      {isLoading ? (
        <EmptyText>Loading…</EmptyText>
      ) : isError ? (
        <div className="flex items-center justify-between gap-3">
          <EmptyText>Could not reach the remote server.</EmptyText>
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium"
            style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
          >
            Retry
          </button>
        </div>
      ) : !data?.linked ? (
        <EmptyText>No remote project linked yet. Pushing a release will create one.</EmptyText>
      ) : !data.fetched && data.reason === 'not_connected' ? (
        <div className="flex items-center justify-between gap-3">
          <EmptyText>Log in to load the linked project.</EmptyText>
          <button
            type="button"
            onClick={() => navigate({ to: '/settings', hash: 'user-section' })}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium"
            style={{ background: 'var(--c-accent)', color: '#fff' }}
          >
            Go to User
          </button>
        </div>
      ) : !data.fetched && data.reason === 'not_found' ? (
        <div>
          <div
            className="mb-3 rounded-md px-3 py-2 text-[12px]"
            style={{ background: 'rgba(168, 112, 51, 0.18)', color: '#a87033' }}
          >
            The linked project no longer exists on the remote. Disconnect to clear it.
          </div>
          <ProjectIdRow projectId={data.projectId} />
          <div className="mt-3 flex justify-end">
            <DisconnectButton onClick={handleDisconnect} pending={patch.isPending} />
          </div>
        </div>
      ) : data.fetched && data.project ? (
        <div className="flex flex-col gap-3">
          <Row label="Name" value={data.project.name} />
          <Row label="Created" value={formatDate(data.project.createdAt)} />
          {data.project.lastReleaseAt ? (
            <Row label="Last release" value={formatDate(data.project.lastReleaseAt)} />
          ) : null}
          {data.project.owner ? (
            <Row
              label="Owner"
              value={`${data.project.owner.email}${data.project.owner.name ? ` · ${data.project.owner.name}` : ''}`}
            />
          ) : null}
          <ProjectIdRow projectId={data.projectId} />
          <div className="mt-1 flex justify-end">
            <DisconnectButton onClick={handleDisconnect} pending={patch.isPending} />
          </div>
        </div>
      ) : null}
    </SettingsCard>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-[12.5px]">
      <span style={{ color: 'var(--c-muted)' }}>{label}</span>
      <span className="col-span-2 truncate" style={{ color: 'var(--c-ink)' }}>
        {value}
      </span>
    </div>
  );
}

function ProjectIdRow({ projectId }: { projectId: string | null }) {
  if (!projectId) return null;
  return (
    <div className="grid grid-cols-3 gap-2 text-[12.5px]">
      <span style={{ color: 'var(--c-muted)' }}>Project ID</span>
      <span className="col-span-2 truncate font-mono text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
        {projectId}
      </span>
    </div>
  );
}

function DisconnectButton({ onClick, pending }: { onClick: () => void; pending: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
      style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
    >
      Disconnect
    </button>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
      {children}
    </p>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
