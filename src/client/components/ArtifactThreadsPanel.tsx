import { History, MessageSquare, MessageSquarePlus } from 'lucide-react';
import type { ArtifactThreadListItem } from '../../shared/entities.js';

interface Props {
  /** Panel heading — each kind names its threads differently ("Editorial", "Resolution", …). */
  title: string;
  /** Second line of the empty state; the first is generic. */
  emptyHint: string;
  threads: ArtifactThreadListItem[];
  onOpen(threadId: string): void;
  onCreate(): void;
  creating: boolean;
  /**
   * "Open last thread" shortcut. Only plan uses it today (backed by
   * `GET /api/plans/:slug/last-thread`); omit it and the button is not rendered.
   */
  lastThreadId?: string | null;
}

/**
 * 0.1.139: the threads panel shared by every artifact detail page — plan
 * (`/plans/:slug`), brief (`/briefs/:path`) and patch (`/patches/:path`). It
 * replaced two byte-identical local `ThreadsPanel` copies in `BriefDetail`/
 * `PatchDetail` and gave the plan page a real panel in place of the top-bar
 * "Used by N threads" dropdown.
 *
 * Purely presentational — every page fetches its own rows via
 * `useArtifactThreads(kind, path)` and owns its create action (plan attaches
 * through `POST /api/plans/:slug/create-thread`, brief/patch through the
 * generic `POST /api/artifacts/:kind/:path/threads`).
 *
 * Rows carry `contextType`/`planMode` because a plan's thread set is
 * heterogeneous by design: any thread kind may attach a `plan_path`. For brief
 * and patch the badge is redundant-but-harmless (their sets are homogeneous by
 * the create-time invariant), so it is rendered only when it says something —
 * see `showContextType`.
 */
export function ArtifactThreadsPanel({
  title,
  emptyHint,
  threads,
  onOpen,
  onCreate,
  creating,
  lastThreadId,
}: Props) {
  const showContextType = new Set(threads.map((t) => t.contextType)).size > 1;

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <div className="mx-auto" style={{ maxWidth: 720, padding: '24px 32px 48px' }}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3
            className="text-[14px] font-semibold flex items-center gap-1.5"
            style={{ color: 'var(--c-ink)' }}
          >
            {title}
            <span
              className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
              style={{ background: 'var(--c-hair)', color: 'var(--c-muted)' }}
              title={`${threads.length} thread(s) reference this artifact`}
            >
              {threads.length}
            </span>
          </h3>
          <div className="flex items-center gap-1.5">
            {lastThreadId !== undefined && (
              <button
                onClick={() => lastThreadId && onOpen(lastThreadId)}
                disabled={!lastThreadId}
                className="rounded-md flex items-center gap-1 px-2 py-1 text-[11.5px] btn-ghost"
                style={{
                  color: 'var(--c-muted)',
                  border: '1px solid var(--c-hair-strong)',
                  opacity: lastThreadId ? 1 : 0.4,
                  cursor: lastThreadId ? undefined : 'not-allowed',
                }}
                title={
                  lastThreadId
                    ? 'Open the most recently active thread'
                    : 'No thread references this artifact yet'
                }
              >
                <History size={11} />
                Open last thread
              </button>
            )}
            <button
              onClick={onCreate}
              disabled={creating}
              className="rounded-md flex items-center gap-1 px-2 py-1 text-[11.5px]"
              style={{ background: 'var(--c-accent)', color: '#fff', opacity: creating ? 0.5 : 1 }}
            >
              <MessageSquarePlus size={11} />
              {creating ? 'Creating…' : 'New conversation'}
            </button>
          </div>
        </div>
        {threads.length === 0 ? (
          <div
            className="text-center py-12 rounded-lg"
            style={{
              background: 'var(--c-card)',
              border: '1px dashed var(--c-hair-strong)',
              color: 'var(--c-subtle)',
            }}
          >
            <div className="text-[13px]">No threads yet.</div>
            <div className="text-[11.5px] mt-1">{emptyHint}</div>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {threads.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => onOpen(t.id)}
                  className="w-full text-left px-3 py-2 rounded-md flex items-center gap-2"
                  style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
                  title={`Last active ${formatRelative(t.updatedAt)}`}
                >
                  <MessageSquare size={12} style={{ color: 'var(--c-muted)' }} />
                  <span className="flex-1 text-[12.5px] truncate" style={{ color: 'var(--c-ink)' }}>
                    {t.title ?? '(untitled)'}
                  </span>
                  {showContextType && (
                    <span
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--c-hair)', color: 'var(--c-muted)' }}
                    >
                      {t.contextType}
                    </span>
                  )}
                  {t.planMode && (
                    <span
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--c-accent-soft)', color: 'var(--c-accent-ink)' }}
                      title="Thread is in plan mode"
                    >
                      plan mode
                    </span>
                  )}
                  <span className="text-[10.5px]" style={{ color: 'var(--c-subtle)' }}>
                    {t.messageCount} msg
                  </span>
                  <span
                    className="text-[10.5px] whitespace-nowrap"
                    style={{ color: 'var(--c-subtle)', minWidth: 56, textAlign: 'right' }}
                  >
                    {formatRelative(t.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** SQLite `datetime('now')` renders `YYYY-MM-DD HH:MM:SS` in UTC without a zone marker. */
function formatRelative(iso: string): string {
  if (!iso) return '';
  const ts = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime();
  if (Number.isNaN(ts)) return iso;
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return `${Math.max(sec, 0)}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
