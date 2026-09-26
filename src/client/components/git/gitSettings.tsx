import { useEffect } from 'react';
import { useGitStatus } from '../../hooks/useGitStatus.js';
import { useGitBranches } from '../../hooks/useGitBranches.js';
import { renderCommitTargetTemplate, localDateYYYYMMDD } from '../../../shared/git.js';
import { EFFECT, type ElementContext, type SettingsContribution } from '../settings/registry.js';

const K = {
  enabled: ['git', 'enabled'],
  syncPushOnPush: ['git', 'syncPushOnPush'],
  mode: ['git', 'commitTarget', 'mode'],
  branch: ['git', 'commitTarget', 'branch'],
  template: ['git', 'commitTarget', 'template'],
  base: ['git', 'commitTarget', 'base'],
  switchAfterRelease: ['git', 'switchAfterRelease'],
} as const;

/**
 * 0.2.113 — the git-sync module's card. One element, three states: git off
 * (an empty state, plus the amber regression banner when a stale
 * `syncPushOnPush: true` survives from before the master switch), no repository
 * detected, and a detected repository with its settings. Everything saves through
 * the card's [Save]; a change acts on the next release, pull or push.
 */
export const GIT_SETTINGS: SettingsContribution = {
  cards: [
    {
      anchor: 'git',
      title: 'Git',
      description: 'Mirror release activity into the git repository that holds your pages.',
      group: 'Project',
      weight: 30,
      owner: 'git-sync',
    },
  ],
  elements: [
    {
      id: 'git-integration',
      card: 'git',
      weight: 10,
      kind: 'custom',
      owner: 'git-sync',
      keys: Object.values(K),
      effectMessage: EFFECT.git,
      component: GitIntegrationElement,
    },
  ],
};

function GitIntegrationElement({ draft }: ElementContext) {
  const enabled = Boolean(draft.get(K.enabled));
  const syncPushOnPush = Boolean(draft.get(K.syncPushOnPush));
  const mode = (draft.get(K.mode) as 'current' | 'named' | 'new' | undefined) ?? 'current';
  const branch = (draft.get(K.branch) as string | null | undefined) ?? '';
  const template = (draft.get(K.template) as string | null | undefined) ?? '';
  const base = (draft.get(K.base) as string | null | undefined) ?? '';
  const switchAfterRelease = Boolean(draft.get(K.switchAfterRelease));
  const disabled = draft.saving;

  const { data: status, isLoading } = useGitStatus({ enabled });
  const { data: branches } = useGitBranches({ enabled: enabled && mode !== 'current' });

  // The companion field of the active mode must be set before anything is sent —
  // the server would refuse the pair anyway.
  const branchMissing = mode === 'named' && !branch;
  const templateMissing = mode === 'new' && !template;
  useEffect(() => {
    draft.setLiveError(K.branch, branchMissing ? 'Pick a branch for the commit target.' : null);
    draft.setLiveError(K.template, templateMissing ? 'Enter a branch name template.' : null);
  }, [branchMissing, templateMissing, draft]);

  const preview = template ? renderTemplatePreview(template) : '';

  return (
    <div className="flex flex-col gap-4">
      <Toggle
        checked={enabled}
        disabled={disabled}
        onChange={(next) => draft.set(K.enabled, next)}
        title="Enable Git integration"
        hint="When enabled, creating a release or pulling unreleased changes automatically git commits the pages, entities, releases and config."
      />

      {!enabled && syncPushOnPush ? (
        <div
          className="rounded-md px-3 py-2 text-[12px]"
          style={{ background: 'rgba(168, 112, 51, 0.18)', color: '#a87033' }}
        >
          Git sync was previously configured but is now off. Enable Git integration to restore it.
        </div>
      ) : null}

      {!enabled ? (
        <EmptyText>Git off — using local history only. Enable to restore commit-on-release and git status.</EmptyText>
      ) : isLoading ? (
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
              checked={syncPushOnPush}
              disabled={disabled}
              onChange={(next) => draft.set(K.syncPushOnPush, next)}
              title="Push on remote push"
              hint="After a release is pushed to the remote server, push the current branch to its upstream."
            />
          </div>

          <div className="flex flex-col gap-3 pt-3" style={{ borderTop: '1px solid var(--c-hair)' }}>
            <div>
              <span className="block text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
                Commit target
              </span>
              <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--c-subtle)' }}>
                Where a release commit lands.
              </span>
            </div>
            <RadioRow
              checked={mode === 'current'}
              disabled={disabled}
              onChange={() => draft.set(K.mode, 'current')}
              label="Current branch"
              hint="Commit on whatever branch HEAD is currently on (previous behavior)."
            />
            <RadioRow
              checked={mode === 'named'}
              disabled={disabled}
              onChange={() => draft.set(K.mode, 'named')}
              label="Specific branch"
              hint="Commit onto an existing branch's tip, without switching HEAD."
            />
            {mode === 'named' ? (
              <div className="ml-7 flex flex-col gap-1">
                <select
                  value={branch}
                  disabled={disabled}
                  onChange={(e) => draft.set(K.branch, e.target.value || null)}
                  className="rounded-md px-2 py-1 text-[12.5px] w-56"
                  style={selectStyle}
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
                {draft.error(K.branch) ? <ErrorText>{draft.error(K.branch)}</ErrorText> : null}
                {branch && branches && !branches.branches.includes(branch) ? (
                  <span className="text-[11.5px]" style={{ color: '#a87033' }}>
                    Saved branch "{branch}" no longer exists.
                  </span>
                ) : null}
              </div>
            ) : null}
            <RadioRow
              checked={mode === 'new'}
              disabled={disabled}
              onChange={() => draft.set(K.mode, 'new')}
              label="New branch"
              hint="Create a new branch from a base branch's tip for each release."
            />
            {mode === 'new' ? (
              <div className="ml-7 flex flex-col gap-2">
                <div className="flex flex-col gap-1">
                  <input
                    type="text"
                    value={template}
                    disabled={disabled}
                    placeholder="release/{release_slug}"
                    onChange={(e) => draft.set(K.template, e.target.value || null)}
                    className="rounded-md px-2 py-1 text-[12.5px] w-56"
                    style={selectStyle}
                  />
                  <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
                    Placeholders: {'{release_slug}'}, {'{release_name}'}, {'{date}'}
                    {preview ? (
                      <>
                        {' '}
                        — preview: <span className="font-mono">{preview}</span>
                      </>
                    ) : null}
                  </span>
                  {draft.error(K.template) ? <ErrorText>{draft.error(K.template)}</ErrorText> : null}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
                    Base branch
                  </span>
                  <select
                    value={base}
                    disabled={disabled}
                    onChange={(e) => draft.set(K.base, e.target.value || null)}
                    className="rounded-md px-2 py-1 text-[12.5px] w-56"
                    style={selectStyle}
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
            ) : null}
            {mode !== 'current' ? (
              <Toggle
                checked={switchAfterRelease}
                disabled={disabled}
                onChange={(next) => draft.set(K.switchAfterRelease, next)}
                title="Switch to branch after release"
                hint="After a successful commit, switch HEAD/working tree to the target branch."
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: 'var(--c-bg)',
  border: '1px solid var(--c-hair)',
  color: 'var(--c-ink)',
};

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11.5px]" role="alert" style={{ color: '#a83232' }}>
      {children}
    </span>
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
