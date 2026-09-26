import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useRemoteProject,
  useUpdateRemoteProject,
} from '../../hooks/useRemoteProject.js';
import { usePatchConfig } from '../../hooks/useConfig.js';
import { ApiError } from '../../lib/api.js';
import { confirmDestructive, toast } from '../../ui/events.js';
import type { RemoteProjectInfo, UpdateRemoteProjectRequest } from '../../../shared/remote-project.js';
import type { SettingsContribution } from '../settings/registry.js';

const NAME_MAX = 120;
const DESC_MAX = 1000;

/**
 * 0.2.113 — the release-push module's card (§4.2). Keyed on `isOwner` and
 * `fetched`:
 *   A  !linked                                  → empty state, no Disconnect.
 *   B  linked + fetched + isOwner               → edit form + owner details.
 *   C  linked + fetched + !isOwner              → read-only, with a notice.
 *   C' linked + !fetched + reason:'not_found'   → "Cannot fetch" banner + Disconnect,
 *      no retry. An anonymous reader of a DRAFT lands here too — the same banner
 *      a deleted project or a bad identifier gets.
 *
 * Logging the remote account out mid-edit refetches without a bearer: a
 * published project drops to C, a draft to C', and the unsaved name and
 * description go with the unmounted form.
 */
export const RELEASE_PUSH_SETTINGS: SettingsContribution = {
  cards: [
    {
      anchor: 'remote-project',
      title: 'Remote project',
      description: 'The remote project this specification publishes to.',
      group: 'Project',
      weight: 20,
      owner: 'release-push',
    },
  ],
  elements: [
    {
      id: 'remote-project',
      card: 'remote-project',
      weight: 10,
      kind: 'custom',
      owner: 'release-push',
      component: RemoteProjectElement,
    },
  ],
};

function RemoteProjectElement() {
  const { data, isLoading, isError, refetch } = useRemoteProject();
  const patch = usePatchConfig();
  const qc = useQueryClient();

  async function handleDisconnect() {
    const name = data?.project?.name ?? data?.projectId ?? '';
    const ok = await confirmDestructive({
      kind: 'remote-project-disconnect',
      title: 'Disconnect remote project',
      body: data?.isOwner
        ? `Disconnect remote project ${name}? The next push will create a new remote project with the current config.name.`
        : `Disconnect remote project ${name}? This clears remoteProjectId in the local config.json. The next push will create a new remote project.`,
      confirmLabel: 'Disconnect',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      await patch.mutateAsync({ remoteProjectId: null });
      // Straight to "no project" — the refetch below confirms it.
      qc.setQueryData<RemoteProjectInfo>(['remote-project'], {
        linked: false,
        projectId: null,
        fetched: false,
        isOwner: false,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['config'] }),
        qc.invalidateQueries({ queryKey: ['remote-project'] }),
      ]);
      toast.success('Disconnected from remote project');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Disconnect failed');
    }
  }

  return (
    <div>
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
        <EmptyText>No remote project connected. The first release push will create a new remote project.</EmptyText>
      ) : !data.fetched && data.reason === 'not_found' ? (
        <div>
          <div
            className="mb-3 rounded-md px-3 py-2 text-[12px]"
            style={{ background: 'rgba(168, 112, 51, 0.18)', color: '#a87033' }}
          >
            Cannot fetch project info for {data.projectId} — it may be a draft, deleted, or you don't have
            access.
          </div>
          <ProjectIdRow projectId={data.projectId} />
          <div className="mt-3 flex justify-end">
            <DisconnectButton onClick={handleDisconnect} pending={patch.isPending} />
          </div>
        </div>
      ) : data.fetched && data.project && data.isOwner ? (
        <OwnerEditor
          name={data.project.name}
          description={data.project.description}
          createdAt={data.project.createdAt}
          lastReleaseAt={data.project.lastReleaseAt}
          owner={data.project.owner}
          projectId={data.projectId}
          onDisconnect={handleDisconnect}
          disconnectPending={patch.isPending}
        />
      ) : data.fetched && data.project ? (
        <NonOwnerView
          name={data.project.name}
          description={data.project.description}
          createdAt={data.project.createdAt}
          projectId={data.projectId}
          onDisconnect={handleDisconnect}
          disconnectPending={patch.isPending}
        />
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Scenario B — owner editor
// -----------------------------------------------------------------------------

interface OwnerEditorProps {
  name: string;
  description: string | null;
  createdAt: string;
  lastReleaseAt?: string;
  owner?: { email: string; name?: string };
  projectId: string | null;
  onDisconnect: () => void;
  disconnectPending: boolean;
}

function OwnerEditor({
  name,
  description,
  createdAt,
  lastReleaseAt,
  owner,
  projectId,
  onDisconnect,
  disconnectPending,
}: OwnerEditorProps) {
  const update = useUpdateRemoteProject();
  const qc = useQueryClient();
  const [draftName, setDraftName] = useState(name);
  const [draftDescription, setDraftDescription] = useState(description ?? '');
  const [fieldError, setFieldError] = useState<{ name?: string; description?: string }>({});

  // Re-sync when the underlying snapshot refreshes (e.g. after a successful
  // submit or an external invalidate). Without this, the form fields stay
  // pinned to the last edit even if the server view changed.
  useEffect(() => {
    setDraftName(name);
    setDraftDescription(description ?? '');
    setFieldError({});
  }, [name, description]);

  const baselineDescription = description ?? '';
  const nameChanged = draftName !== name;
  const descriptionChanged = draftDescription !== baselineDescription;
  const dirty = nameChanged || descriptionChanged;
  const nameInvalid = draftName.length < 1 || draftName.length > NAME_MAX;
  const descriptionInvalid = draftDescription.length > DESC_MAX;
  const submitDisabled = !dirty || nameInvalid || descriptionInvalid || update.isPending;

  async function handleSubmit() {
    if (submitDisabled) return;
    const body: UpdateRemoteProjectRequest = {};
    if (nameChanged) body.name = draftName;
    if (descriptionChanged) body.description = draftDescription === '' ? null : draftDescription;
    setFieldError({});
    try {
      await update.mutateAsync(body);
      toast.success('Remote project updated');
    } catch (err) {
      // A value the live checks let through but the server refused: its message,
      // under the field it concerns.
      if (err instanceof ApiError && err.code === 'INVALID_BODY') {
        const field = err.details?.field as 'name' | 'description' | undefined;
        if (field) {
          setFieldError({ [field]: err.message });
        } else {
          toast.error(err.message);
        }
        return;
      }
      if (err instanceof ApiError && err.code === 'NOT_OWNER') {
        // The card switches to read-only on the refetch.
        toast.error('You are not the owner of this project');
        void qc.invalidateQueries({ queryKey: ['remote-project'] });
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Name" error={fieldError.name}>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            maxLength={NAME_MAX + 1}
            className="flex-1 rounded-md px-3 py-1.5 text-[13px]"
            style={inputStyle}
          />
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--c-subtle)' }}>
            {draftName.length}/{NAME_MAX}
          </span>
        </div>
      </Field>

      <Field label="Description" error={fieldError.description}>
        <textarea
          value={draftDescription}
          onChange={(e) => setDraftDescription(e.target.value)}
          rows={3}
          placeholder="No description"
          className="w-full rounded-md px-3 py-2 text-[13px]"
          style={inputStyle}
        />
        <div className="mt-1 flex justify-end">
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--c-subtle)' }}>
            {draftDescription.length}/{DESC_MAX}
          </span>
        </div>
      </Field>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitDisabled}
          className="rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
        >
          {update.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      <div className="flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid var(--c-hair)' }}>
        <Row label="Created" value={formatDate(createdAt)} />
        {lastReleaseAt ? <Row label="Last release" value={formatDate(lastReleaseAt)} /> : null}
        {owner ? (
          <Row
            label="Owner"
            value={`${owner.email}${owner.name ? ` · ${owner.name}` : ''}`}
          />
        ) : null}
        <ProjectIdRow projectId={projectId} />
      </div>

      <div className="flex justify-end">
        <DisconnectButton onClick={onDisconnect} pending={disconnectPending} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Scenario C — non-owner / anonymous read-only view
// -----------------------------------------------------------------------------

interface NonOwnerViewProps {
  name: string;
  description: string | null;
  createdAt: string;
  projectId: string | null;
  onDisconnect: () => void;
  disconnectPending: boolean;
}

function NonOwnerView({
  name,
  description,
  createdAt,
  projectId,
  onDisconnect,
  disconnectPending,
}: NonOwnerViewProps) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className="rounded-md px-3 py-2 text-[12px]"
        style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
      >
        Read-only — you are not the owner of this remote project.
      </div>
      <Row label="Name" value={name} />
      <Row label="Description" value={description ?? '—'} />
      <Row label="Created" value={formatDate(createdAt)} />
      <ProjectIdRow projectId={projectId} />
      <div className="mt-1 flex justify-end">
        <DisconnectButton onClick={onDisconnect} pending={disconnectPending} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Atoms
// -----------------------------------------------------------------------------

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

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span
        className="text-[11.5px] font-medium uppercase tracking-wide"
        style={{ color: 'var(--c-muted)' }}
      >
        {label}
      </span>
      {children}
      {error ? (
        <span className="text-[11.5px]" style={{ color: '#a83232' }}>
          {error}
        </span>
      ) : null}
    </label>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const inputStyle: React.CSSProperties = {
  background: 'var(--c-bg)',
  border: '1px solid var(--c-hair)',
  color: 'var(--c-ink)',
};
