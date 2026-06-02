import { useConfig, usePatchConfig } from '../../../hooks/useConfig.js';
import { useGitStatus } from '../../../hooks/useGitStatus.js';
import { ApiError } from '../../../lib/api.js';
import { toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';

/**
 * M28 §6 — Git Sync section. Fetches `GET /api/git/status`; when no repo is
 * detected it renders a muted empty state and hides the toggles. When a repo is
 * detected it shows a repo info card (remote URL, branch, root, dirty/clean
 * badge) and two hot-reload toggles wired to `PATCH /api/config` (deep-merged
 * server-side, so one toggle can be sent without clobbering the other).
 */
export function GitSection() {
  const { data: config } = useConfig();
  const { data: status, isLoading } = useGitStatus();
  const patch = usePatchConfig();

  const git = config?.git ?? { syncCommitOnRelease: false, syncPushOnPush: false };

  async function toggle(
    field: 'syncCommitOnRelease' | 'syncPushOnPush',
    next: boolean,
  ) {
    try {
      await patch.mutateAsync({ git: { [field]: next } });
      toast.success('Git settings updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  return (
    <SettingsCard
      id="git"
      title="Git"
      description="Mirror release activity into the git repository that holds your pages."
      badge="hot-reload"
    >
      {isLoading ? (
        <EmptyText>Loading…</EmptyText>
      ) : !status?.detected ? (
        <EmptyText>
          Your pages directory is not inside a git repository. Git sync is unavailable.
        </EmptyText>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Row label="Remote" value={status.remoteUrl ?? 'No origin remote'} />
            <Row label="Branch" value={status.branch ?? 'Detached HEAD'} />
            <Row label="Root" value={status.rootPath ?? '—'} mono />
            <div className="grid grid-cols-3 gap-2 text-[12.5px]">
              <span style={{ color: 'var(--c-muted)' }}>Working tree</span>
              <span className="col-span-2">
                <DirtyBadge dirty={status.isDirty} />
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-3" style={{ borderTop: '1px solid var(--c-hair)' }}>
            <Toggle
              checked={git.syncCommitOnRelease}
              disabled={patch.isPending}
              onChange={(next) => void toggle('syncCommitOnRelease', next)}
              title="Commit on release"
              hint="When you create a release, commit pages and config.json with a message from the release name and description."
            />
            <Toggle
              checked={git.syncPushOnPush}
              disabled={patch.isPending}
              onChange={(next) => void toggle('syncPushOnPush', next)}
              title="Push on remote push"
              hint="After a release is pushed to the remote server, push the current branch to its upstream."
            />
          </div>
        </div>
      )}
    </SettingsCard>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  title: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4"
      />
      <span className="flex-1">
        <span className="block text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
          {title}
        </span>
        <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--c-subtle)' }}>
          {hint}
        </span>
      </span>
    </label>
  );
}

function DirtyBadge({ dirty }: { dirty: boolean }) {
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide"
      style={
        dirty
          ? { background: 'rgba(168, 112, 51, 0.18)', color: '#a87033' }
          : { background: 'var(--c-accent-soft)', color: 'var(--c-accent)' }
      }
    >
      {dirty ? 'Uncommitted changes' : 'Clean'}
    </span>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-[12.5px]">
      <span style={{ color: 'var(--c-muted)' }}>{label}</span>
      <span
        className={`col-span-2 truncate${mono ? ' font-mono text-[11.5px]' : ''}`}
        style={{ color: mono ? 'var(--c-subtle)' : 'var(--c-ink)' }}
      >
        {value}
      </span>
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
      {children}
    </p>
  );
}
