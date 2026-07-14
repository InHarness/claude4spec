import { useEffect, useState } from 'react';
import { useConfig, usePatchConfig } from '../../../hooks/useConfig.js';
import { useGitStatus } from '../../../hooks/useGitStatus.js';
import { useGitBranches } from '../../../hooks/useGitBranches.js';
import { ApiError, type ConfigPatch } from '../../../lib/api.js';
import { toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';
import { renderCommitTargetTemplate, localDateYYYYMMDD } from '../../../../shared/git.js';

/**
 * M28 §6 — Git section. 0.1.118 adds `git.enabled`, a master switch for the
 * entire git layer: an always-visible toggle renders first, regardless of
 * loading/detection state. When off, sync/status stay local-only (empty
 * state, sub-toggle hidden — not merely disabled). When on, this behaves as
 * before: `GET /api/git/status` drives a repo info card (remote URL, branch,
 * root, dirty/clean badge) and a hot-reload push sync toggle, or a "No git
 * repository detected." empty state if no repo is found.
 *
 * 0.1.124: `syncCommitOnRelease` was removed — `git.enabled` alone now also
 * gates commit-on-release/commit-on-pull, so there is no longer a "git on,
 * but doesn't commit" state and no separate checkbox for it. The amber
 * regression banner (B1) now only fires for a stale `syncPushOnPush: true`
 * left on from before the master switch existed.
 *
 * 0.1.125: adds the "Commit target" selector (current / specific / new
 * branch, `config.git.commitTarget`) and the "Switch to branch after
 * release" checkbox (`config.git.switchAfterRelease`) — see `CommitTarget`.
 */
const DEFAULT_GIT = {
  enabled: false,
  syncPushOnPush: false,
  commitTarget: { mode: 'current' as const, branch: null, template: null, base: null },
  switchAfterRelease: false,
};

export function GitSection() {
  const { data: config } = useConfig();
  const git = config?.git ?? DEFAULT_GIT;
  // Gated: the repo-card/sub-toggle content below only renders when
  // git.enabled is true, so an ungated fetch when it's false (the default)
  // would be a wasted round trip on every Settings visit.
  const { data: status, isLoading } = useGitStatus({ enabled: git.enabled });
  const patch = usePatchConfig();

  async function toggle(field: 'syncPushOnPush' | 'switchAfterRelease', next: boolean) {
    try {
      await patch.mutateAsync({ git: { [field]: next } });
      toast.success('Git settings updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function toggleEnabled(next: boolean) {
    try {
      await patch.mutateAsync({ git: { enabled: next } });
      toast.success(next ? 'Git integration enabled' : 'Git integration disabled');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function saveCommitTarget(commitTarget: NonNullable<ConfigPatch['git']>['commitTarget']) {
    try {
      await patch.mutateAsync({ git: { commitTarget } });
      toast.success('Git settings updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  const showRegressionBanner = !git.enabled && git.syncPushOnPush;

  return (
    <SettingsCard
      id="git"
      title="Git"
      description="Mirror release activity into the git repository that holds your pages."
    >
      <div className="flex flex-col gap-4">
        <Toggle
          checked={git.enabled}
          disabled={patch.isPending}
          onChange={(next) => void toggleEnabled(next)}
          title="Enable Git integration"
          hint="When enabled, creating a release or pulling unreleased changes automatically git commits the pages, entities, releases and config."
        />

        {showRegressionBanner && (
          <div
            className="rounded-md px-3 py-2 text-[12px]"
            style={{ background: 'rgba(168, 112, 51, 0.18)', color: '#a87033' }}
          >
            Git sync was previously configured but is now off. Enable Git integration to restore it.
          </div>
        )}

        {!git.enabled && (
          <EmptyText>
            Git off — using local history only. Enable to restore commit-on-release and git status.
          </EmptyText>
        )}

        {git.enabled &&
          (isLoading ? (
            <EmptyText>Loading…</EmptyText>
          ) : !status?.detected ? (
            <EmptyText>No git repository detected.</EmptyText>
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
                  checked={git.syncPushOnPush}
                  disabled={patch.isPending}
                  onChange={(next) => void toggle('syncPushOnPush', next)}
                  title="Push on remote push"
                  hint="After a release is pushed to the remote server, push the current branch to its upstream."
                />
              </div>

              <div className="flex flex-col gap-3 pt-3" style={{ borderTop: '1px solid var(--c-hair)' }}>
                <CommitTargetSection
                  commitTarget={git.commitTarget}
                  switchAfterRelease={git.switchAfterRelease}
                  disabled={patch.isPending}
                  onSaveCommitTarget={saveCommitTarget}
                  onToggleSwitchAfterRelease={(next) => void toggle('switchAfterRelease', next)}
                />
              </div>
            </div>
          ))}
      </div>
    </SettingsCard>
  );
}

type CommitTargetValue = {
  mode: 'current' | 'named' | 'new';
  branch: string | null;
  template: string | null;
  base: string | null;
};
type CommitTargetPatch = NonNullable<ConfigPatch['git']>['commitTarget'];

/**
 * 0.1.125 — "Commit target" selector + "Switch to branch after release"
 * checkbox. A local `mode` tracks the RADIO selection independent of the
 * saved config: switching to "Specific"/"New" only updates the local UI
 * (revealing the branch-select / template-input) — the actual PATCH fires
 * once the user picks a concrete branch or fills in a template, matching
 * the server's requirement that `named`/`new` carry a non-empty
 * `branch`/`template`. This avoids a 400 round trip on an incomplete
 * selection. Branch/base dropdowns reuse `useGitBranches` (already built for
 * the sidebar git badge and, per its own doc comment, anticipated for this
 * exact picker) rather than a new endpoint.
 */
function CommitTargetSection({
  commitTarget,
  switchAfterRelease,
  disabled,
  onSaveCommitTarget,
  onToggleSwitchAfterRelease,
}: {
  commitTarget: CommitTargetValue;
  switchAfterRelease: boolean;
  disabled: boolean;
  onSaveCommitTarget: (next: CommitTargetPatch) => void;
  onToggleSwitchAfterRelease: (next: boolean) => void;
}) {
  const [mode, setMode] = useState(commitTarget.mode);
  useEffect(() => setMode(commitTarget.mode), [commitTarget.mode]);

  const [branchDraft, setBranchDraft] = useState(commitTarget.branch ?? '');
  useEffect(() => setBranchDraft(commitTarget.branch ?? ''), [commitTarget.branch]);

  const [templateDraft, setTemplateDraft] = useState(commitTarget.template ?? '');
  useEffect(() => setTemplateDraft(commitTarget.template ?? ''), [commitTarget.template]);

  const [baseDraft, setBaseDraft] = useState(commitTarget.base ?? '');
  useEffect(() => setBaseDraft(commitTarget.base ?? ''), [commitTarget.base]);

  const { data: branches } = useGitBranches({ enabled: mode !== 'current' });

  function selectMode(next: 'current' | 'named' | 'new') {
    setMode(next);
    if (next === 'current') {
      onSaveCommitTarget({ mode: 'current' });
    } else if (next === 'named' && branchDraft) {
      onSaveCommitTarget({ mode: 'named', branch: branchDraft });
    } else if (next === 'new' && templateDraft) {
      onSaveCommitTarget({ mode: 'new', template: templateDraft, base: baseDraft || null });
    }
    // 'named'/'new' with no draft value yet — just reveal the picker; the
    // PATCH fires once the user actually chooses a branch / types a template.
  }

  const preview = templateDraft ? renderTemplatePreview(templateDraft) : '';

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="block text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
          Commit target
        </span>
        <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--c-subtle)' }}>
          Where a release commit lands.
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <RadioRow
          checked={mode === 'current'}
          disabled={disabled}
          onChange={() => selectMode('current')}
          label="Current branch"
          hint="Commit on whatever branch HEAD is currently on (previous behavior)."
        />
        <RadioRow
          checked={mode === 'named'}
          disabled={disabled}
          onChange={() => selectMode('named')}
          label="Specific branch"
          hint="Commit onto an existing branch's tip, without switching HEAD."
        />
        {mode === 'named' && (
          <div className="ml-7 flex flex-col gap-1">
            <select
              value={branchDraft}
              disabled={disabled}
              onChange={(e) => {
                setBranchDraft(e.target.value);
                onSaveCommitTarget({ mode: 'named', branch: e.target.value });
              }}
              className="rounded-md px-2 py-1 text-[12.5px] w-56"
              style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
            >
              <option value="" disabled>
                Select a branch…
              </option>
              {(branches?.branches ?? []).map((b) => (
                <option key={b} value={b}>
                  {b === branches?.current ? `${b} (current)` : b}
                </option>
              ))}
            </select>
            {commitTarget.branch && branches && !branches.branches.includes(commitTarget.branch) && (
              <span className="text-[11.5px]" style={{ color: '#a87033' }}>
                Saved branch "{commitTarget.branch}" no longer exists.
              </span>
            )}
          </div>
        )}

        <RadioRow
          checked={mode === 'new'}
          disabled={disabled}
          onChange={() => selectMode('new')}
          label="New branch"
          hint="Create a new branch from a base branch's tip for each release."
        />
        {mode === 'new' && (
          <div className="ml-7 flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <input
                type="text"
                value={templateDraft}
                disabled={disabled}
                placeholder="release/{release_slug}"
                onChange={(e) => setTemplateDraft(e.target.value)}
                onBlur={() => {
                  if (templateDraft && templateDraft !== (commitTarget.template ?? '')) {
                    onSaveCommitTarget({ mode: 'new', template: templateDraft, base: baseDraft || null });
                  }
                }}
                className="rounded-md px-2 py-1 text-[12.5px] w-56"
                style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
              />
              <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
                Placeholders: {'{release_slug}'}, {'{release_name}'}, {'{date}'}
                {preview && (
                  <>
                    {' '}
                    — preview: <span className="font-mono">{preview}</span>
                  </>
                )}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
                Base branch
              </span>
              <select
                value={baseDraft}
                disabled={disabled}
                onChange={(e) => {
                  const next = e.target.value;
                  setBaseDraft(next);
                  if (templateDraft) {
                    onSaveCommitTarget({ mode: 'new', template: templateDraft, base: next || null });
                  }
                }}
                className="rounded-md px-2 py-1 text-[12.5px] w-56"
                style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
              >
                <option value="">(default)</option>
                {(branches?.branches ?? []).map((b) => (
                  <option key={b} value={b}>
                    {b === branches?.current ? `${b} (current)` : b}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {mode !== 'current' && (
        <Toggle
          checked={switchAfterRelease}
          disabled={disabled}
          onChange={onToggleSwitchAfterRelease}
          title="Switch to branch after release"
          hint="After a successful commit, switch HEAD/working tree to the target branch."
        />
      )}
    </div>
  );
}

/** Live preview only — shares `renderCommitTargetTemplate` (src/shared/git.ts) with the server so the two never drift out of sync; the authoritative ref-format check still happens server-side on PATCH. */
function renderTemplatePreview(template: string): string {
  return renderCommitTargetTemplate(template, { releaseName: 'Preview Release', date: localDateYYYYMMDD(new Date()) });
}

function RadioRow({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-3">
      <input type="radio" checked={checked} disabled={disabled} onChange={onChange} className="mt-0.5 h-4 w-4" />
      <span className="flex-1">
        <span className="block text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
          {label}
        </span>
        <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--c-subtle)' }}>
          {hint}
        </span>
      </span>
    </label>
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
