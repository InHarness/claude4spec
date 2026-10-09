import { useState } from 'react';
import { Dialog } from '../../host-ui-kit/overlay/Dialog.js';
import { startSeededThread } from '../../chat/startSeededThread.js';
import { useConfig } from '../../hooks/useConfig.js';
import { useGitSync } from '../../hooks/useGitRemoteOps.js';
import { syncOutcome } from '../../lib/git-results.js';
import { setGitFlashToast } from '../../lib/git-flash.js';
import { reloadProjectRoute } from '../../lib/project-reload.js';
import { toast } from '../events.js';
import type { GitErrorRecovery } from '../../../shared/git.js';
import type { ModalFormProps } from '../ModalHost.js';

const OPERATION_LABEL: Record<GitErrorRecovery['operation'], string> = {
  'commit-on-release': 'Committing the release',
  pull: 'Committing pulled changes',
  push: 'Pushing to the remote',
};

/**
 * 0.1.125: narrows WHY a commit-target/switch operation failed — orthogonal
 * to `OPERATION_LABEL` (WHAT was running). Absent for ordinary git failures.
 */
const KIND_HINT: Record<NonNullable<GitErrorRecovery['kind']>, string> = {
  'branch-missing': 'The configured target branch no longer exists.',
  'base-missing': 'The configured base branch no longer exists (or the repository has no commits).',
  'switch-dirty': 'The commit succeeded, but uncommitted changes blocked switching to the target branch.',
  'switch-failed': 'The commit succeeded, but switching to the target branch failed.',
  // 2.1.10 (M28 u5vl07ch): the window offers Sync instead of the agent.
  'non-fast-forward': "The remote has commits you don't have yet.",
};

/**
 * 0.1.124: M28 git-sync error recovery. Replaces the old
 * `toast.warning('Git commit/push failed: ...')` pattern on
 * `gitSync.status === 'error'` — a persistent modal instead of a
 * fire-and-forget toast, framed as post-hoc ("the business action already
 * succeeded — only git sync hit a problem"), with a "Fix it with Agent"
 * action that seeds a chat thread with a backend-composed recovery prompt.
 * 0.2.110: the `git-sync-recover` modal kind (`showGitErrorModal` →
 * `openModal('git-sync-recover', { recovery })`), rendered by `<ModalHost/>`.
 * 2.1.10: `kind: 'non-fast-forward'` (push) offers `Sync` instead of
 * "Fix it with Agent".
 */
export function GitSyncRecover({ request, onClose }: ModalFormProps<'git-sync-recover'>) {
  const { data: config } = useConfig();
  // Absent field = the flag is on, matching the server default.
  const blockedByPosture = config?.agent?.disableDirectFilesystemAccess ?? true;
  const [expanded, setExpanded] = useState(false);
  const [syncHint, setSyncHint] = useState<string | null>(null);
  const { recovery } = request.props;
  // 2.1.10 (M28 u5vl07ch): a push the remote rejected as non-fast-forward is
  // repaired by pulling the remote commits in, not by the agent.
  const offersSync = recovery.kind === 'non-fast-forward';

  /**
   * `Sync` calls `POST /api/git/sync`; its result is handled by the sync toasts
   * of the header entry (M28 8i5qf0xx) — the same `syncOutcome` table. After a
   * sync that moved HEAD the project route reloads with the toast parked
   * across it.
   *
   * The outcome is handled by mutation-level callbacks (`useGitSync(handlers)`),
   * not `mutate()` callbacks: those die with the component, and a sync whose
   * window was taken off screen mid-flight would lose its reload and leave
   * `useGitOpsStore.pending` at `'sync'`. While Sync is in flight the window
   * itself cannot be dismissed either (Dismiss, Esc, scrim, ✕).
   *
   * ASSUMPTION:dev-0002 `busy` (a hint at the header entry, not a toast) is
   * shown inside this window, which stays open so Sync can be retried.
   */
  const syncOp = useGitSync({
    onSuccess: (result) => {
      const outcome = syncOutcome(result);
      if (outcome.reload) {
        if (outcome.toast) setGitFlashToast(outcome.toast);
        onClose(null);
        reloadProjectRoute();
        return;
      }
      if (outcome.entryHint) {
        setSyncHint(outcome.entryHint);
        return;
      }
      if (outcome.toast) toast[outcome.toast.variant](outcome.toast.message);
      onClose(null);
    },
    onError: () => {
      toast.error('Sync failed.');
      onClose(null);
    },
  });
  const syncing = syncOp.isPending;

  function onSync() {
    if (syncing) return;
    setSyncHint(null);
    syncOp.mutate();
  }

  function dismiss() {
    if (syncing) return;
    onClose(null);
  }

  return (
    <Dialog
      open
      onClose={dismiss}
      dismissible={!syncing}
      title="Done — but git sync hit a problem"
      size="md"
      footer={
        <>
          <button
            data-git-recover-dismiss
            onClick={dismiss}
            disabled={syncing}
            style={{
              fontSize: 12,
              padding: '6px 12px',
              borderRadius: 4,
              color: 'var(--c-muted)',
              opacity: syncing ? 0.6 : 1,
            }}
          >
            Dismiss
          </button>
          {/*
            * 0.2.53: git recovery drives git through the built-in `Bash`, and no
            * core operation replaces it — this is the most painful of the four
            * capabilities the default posture costs. So say what is in the way
            * instead of opening a thread whose agent has nothing to work with:
            * the turn would start, fail to find a shell, and improvise.
            */}
          {offersSync ? (
            <button
              data-git-recover-sync
              onClick={onSync}
              disabled={syncing}
              style={{
                fontSize: 12,
                padding: '6px 14px',
                borderRadius: 4,
                fontWeight: 500,
                background: 'var(--c-accent)',
                color: '#fff',
                opacity: syncing ? 0.6 : 1,
              }}
            >
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
          ) : blockedByPosture ? (
            <span style={{ fontSize: 11.5, color: 'var(--c-subtle)', maxWidth: 320, textAlign: 'right' }}>
              Fixing this with the agent needs a shell. Uncheck “Block direct file access” in Settings → Agent first.
            </span>
          ) : (
            <button
              data-git-recover-agent
              onClick={() => {
                startSeededThread(recovery.intentPrompt, { autoSubmit: true });
                onClose(null);
              }}
              style={{
                fontSize: 12,
                padding: '6px 14px',
                borderRadius: 4,
                fontWeight: 500,
                background: 'var(--c-accent)',
                color: '#fff',
              }}
            >
              Fix it with Agent
            </button>
          )}
        </>
      }
    >
      <div
        style={{
          fontSize: 13.5,
          color: 'var(--c-muted)',
          lineHeight: 1.5,
          marginBottom: recovery.kind ? 4 : 12,
        }}
      >
        {OPERATION_LABEL[recovery.operation]} failed: {recovery.reason}
      </div>

      {recovery.kind && (
        <div
          data-git-recover-kind-hint
          style={{ fontSize: 12.5, color: 'var(--c-subtle)', lineHeight: 1.5, marginBottom: 12 }}
        >
          {KIND_HINT[recovery.kind]}
        </div>
      )}

      {syncHint && (
        <div data-git-recover-sync-hint style={{ fontSize: 12, color: 'var(--c-subtle)', marginBottom: 12 }}>
          {syncHint}
        </div>
      )}

      <button
        data-git-recover-details-toggle
        onClick={() => setExpanded((v) => !v)}
        style={{ fontSize: 11.5, color: 'var(--c-subtle)', marginBottom: expanded ? 10 : 0 }}
      >
        {expanded ? '▾ Hide details' : '▸ Show details'}
      </button>

      {expanded && (
        <div
          data-git-recover-details
          className="font-mono"
          style={{
            fontSize: 11,
            color: 'var(--c-subtle)',
            background: 'var(--c-bg)',
            border: '1px solid var(--c-hair)',
            borderRadius: 6,
            padding: 10,
            maxHeight: 180,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          <div style={{ marginBottom: 6 }}>operation: {recovery.operation}</div>
          {recovery.kind && <div style={{ marginBottom: 6 }}>kind: {recovery.kind}</div>}
          <div style={{ marginBottom: 6 }}>reason: {recovery.reason}</div>
          <div>gitStderr:{'\n'}{recovery.gitStderr || '(empty)'}</div>
        </div>
      )}
    </Dialog>
  );
}
