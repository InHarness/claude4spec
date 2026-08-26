import { Terminal, Activity, Workflow, Cog, FileText } from 'lucide-react';
import type { BackgroundTaskEntry } from './useChat.js';

/**
 * M17: an engine-backgrounded task (a `run_in_background` shell, a Monitor loop,
 * a workflow run) surfaced as a compact status row. Deliberately NOT the
 * subagent panel (blue, expandable agent transcript) nor the transagent panel
 * (accent-bordered nested child) — a backgrounded process is neither a spawned
 * helper agent nor a child banka, and must not read as one. Uses the paper/terra
 * accent in a flat single-row form so the form factor alone sets it apart.
 *
 * ## `status` is an OPAQUE LABEL (0.2.50)
 *
 * It used to be normalized onto running/failed/done and coloured accordingly.
 * That is now forbidden, and the reason is that the mapping was a guess: the
 * contract types `background_task_completed.status` as a bare, undocumented
 * string with no enumerated values, so any success/failure classification is
 * invented rather than read. A wrong green on a failed build is worse than no
 * colour at all.
 *
 * The literal consequence, which is intended and not an oversight: **a failed
 * background task looks exactly like a successful one.** The only distinction
 * the UI draws is running vs. settled, which IS knowable — a task is running
 * until its `_completed` event arrives.
 */
export function BackgroundTaskPanel({ entry }: { entry: BackgroundTaskEntry }) {
  // 'running' is OUR sentinel, written when `_started` is seen and replaced by
  // whatever string the engine sends on `_completed`. `'abandoned'` is ours too
  // (the server's orphan finalizer). Everything else is the engine's, verbatim.
  const running = entry.status === 'running';
  const Icon = iconFor(entry.taskType);

  return (
    <div
      className="mb-3 rounded-lg overflow-hidden"
      style={{ border: '1px solid var(--c-accent-soft)', background: 'var(--c-accent-soft)' }}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px]">
        <Icon size={13} style={{ color: 'var(--c-accent-ink, var(--c-accent))' }} />
        <span
          className="font-mono uppercase tracking-wider"
          style={{ color: 'var(--c-accent-ink, var(--c-accent))' }}
        >
          background · {entry.taskType}
        </span>
        <span className="flex-1" />
        {running ? (
          <span
            className="inline-flex items-center gap-1 font-mono uppercase tracking-wider text-[10.5px]"
            style={{ color: 'var(--c-accent-ink, var(--c-accent))' }}
          >
            <span className="dot-pulse">
              <span></span>
              <span></span>
              <span></span>
            </span>
            running
          </span>
        ) : (
          // Neutral chrome, always. No branch on the value — see the note above.
          <span
            className="font-mono uppercase tracking-wider text-[10.5px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--c-hair)', color: 'var(--c-muted)' }}
            title="Status reported by the engine, shown verbatim"
          >
            {entry.status}
          </span>
        )}
        <span
          className="inline-block rounded-full"
          style={{
            width: 7,
            height: 7,
            background: running ? 'var(--c-accent)' : 'var(--c-muted)',
          }}
          aria-hidden
        />
      </div>
      <div
        className="px-2.5 py-2 text-[12.5px]"
        style={{ background: 'var(--c-bg)', borderTop: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
      >
        <div className="break-words">{entry.description || '(background task)'}</div>
        {entry.summary && (
          <div className="mt-1 text-[12px]" style={{ color: 'var(--c-muted)' }}>
            {entry.summary}
          </div>
        )}
        {entry.outputFile && (
          <div
            className="mt-1 inline-flex items-center gap-1 font-mono text-[11px]"
            style={{ color: 'var(--c-subtle)' }}
            title="Engine streams this task's output into this file"
          >
            <FileText size={11} />
            {entry.outputFile}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * `BackgroundTaskType` is an OPEN union (`'shell' | 'monitor' | 'workflow' |
 * (string & {})`), so the `default` branch is required, not defensive padding: a
 * task kind added by a future SDK must render under its own name rather than
 * take the block down.
 *
 * Wire-level SDK values (e.g. `local_bash`) must never arrive here — the adapter
 * strips that prefix. Seeing one means the normalization path is broken.
 */
function iconFor(taskType: string) {
  switch (taskType) {
    case 'shell':
      return Terminal;
    case 'monitor':
      return Activity;
    case 'workflow':
      return Workflow;
    default:
      return Cog;
  }
}

