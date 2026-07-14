import { useEffect, useState } from 'react';
import { startSeededThread } from '../chat/startSeededThread.js';
import { UI_EVENTS, type GitErrorModalRequest } from './events.js';

const OPERATION_LABEL: Record<GitErrorModalRequest['recovery']['operation'], string> = {
  'commit-on-release': 'Committing the release',
  pull: 'Committing pulled changes',
  push: 'Pushing to the remote',
};

/**
 * 0.1.125: narrows WHY a commit-target/switch operation failed — orthogonal
 * to `OPERATION_LABEL` (WHAT was running). Absent for ordinary git failures.
 */
const KIND_HINT: Record<NonNullable<GitErrorModalRequest['recovery']['kind']>, string> = {
  'branch-missing': 'The configured target branch no longer exists.',
  'base-missing': 'The configured base branch no longer exists (or the repository has no commits).',
  'switch-dirty': 'The commit succeeded, but uncommitted changes blocked switching to the target branch.',
  'switch-failed': 'The commit succeeded, but switching to the target branch failed.',
};

/**
 * 0.1.124: M28 git-sync error recovery. Replaces the old
 * `toast.warning('Git commit/push failed: ...')` pattern on
 * `gitSync.status === 'error'` — a persistent modal instead of a
 * fire-and-forget toast, framed as post-hoc ("the business action already
 * succeeded — only git sync hit a problem"), with a "Fix it with Agent"
 * action that seeds a chat thread with a backend-composed recovery prompt.
 * Event-bus singleton (`showGitErrorModal`), same pattern as `ModalHost`/
 * `confirmDestructive` — mounted once in `App.tsx`.
 */
export function GitErrorRecoveryModal() {
  const [request, setRequest] = useState<GitErrorModalRequest | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<GitErrorModalRequest>;
      setExpanded(false);
      setRequest(ce.detail);
    };
    window.addEventListener(UI_EVENTS.GIT_ERROR, handler as EventListener);
    return () => window.removeEventListener(UI_EVENTS.GIT_ERROR, handler as EventListener);
  }, []);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setRequest(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request]);

  if (!request) return null;
  const { recovery } = request;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Git sync error"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setRequest(null);
      }}
    >
      <div
        style={{
          width: 460,
          maxWidth: 'calc(100vw - 32px)',
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair-strong)',
          borderRadius: 8,
          padding: 20,
          boxShadow: '0 20px 48px rgba(0,0,0,0.20)',
        }}
      >
        <div
          style={{
            fontFamily: 'Lora, serif',
            fontSize: 16,
            color: 'var(--c-ink)',
            marginBottom: 10,
            fontWeight: 500,
          }}
        >
          Done — but git sync hit a problem
        </div>
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
            style={{
              fontSize: 12.5,
              color: 'var(--c-subtle)',
              lineHeight: 1.5,
              marginBottom: 12,
            }}
          >
            {KIND_HINT[recovery.kind]}
          </div>
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            fontSize: 11.5,
            color: 'var(--c-subtle)',
            marginBottom: expanded ? 10 : 20,
          }}
        >
          {expanded ? '▾ Hide details' : '▸ Show details'}
        </button>

        {expanded && (
          <div
            className="font-mono"
            style={{
              fontSize: 11,
              color: 'var(--c-subtle)',
              background: 'var(--c-bg)',
              border: '1px solid var(--c-hair)',
              borderRadius: 6,
              padding: 10,
              marginBottom: 20,
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => setRequest(null)}
            style={{
              fontSize: 12,
              padding: '6px 12px',
              borderRadius: 4,
              color: 'var(--c-muted)',
            }}
          >
            Dismiss
          </button>
          <button
            onClick={() => {
              startSeededThread(recovery.intentPrompt, { autoSubmit: true });
              setRequest(null);
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
        </div>
      </div>
    </div>
  );
}
