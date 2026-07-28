import { Terminal, Activity, Workflow, Cog, FileText } from 'lucide-react';
import type { BackgroundTaskEntry } from './useChat.js';

/**
 * M17: an engine-backgrounded task (a `run_in_background` shell, a Monitor loop,
 * a workflow run) surfaced as a compact status row. Deliberately NOT the
 * subagent panel (blue, expandable agent transcript) nor the transagent panel
 * (accent-bordered nested child) — a backgrounded process is neither a spawned
 * helper agent nor a child banka, and must not read as one. Uses the paper/terra
 * accent in a flat single-row form so the form factor alone sets it apart.
 */
export function BackgroundTaskPanel({ entry }: { entry: BackgroundTaskEntry }) {
  const status = normalizeStatus(entry.status);
  const running = status === 'running';
  const Icon = iconFor(entry.taskType);

  const dotColor = running
    ? 'var(--c-accent)'
    : status === 'failed'
      ? 'var(--c-red, #c45a3b)'
      : 'var(--c-green, #4a9860)';

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
          <span
            className="font-mono uppercase tracking-wider text-[10.5px] px-1.5 py-0.5 rounded"
            style={
              status === 'failed'
                ? { background: 'var(--c-red-soft)', color: 'var(--c-red)' }
                : { background: 'var(--c-green-soft)', color: 'var(--c-green)' }
            }
          >
            {entry.status}
          </span>
        )}
        <span
          className="inline-block rounded-full"
          style={{ width: 7, height: 7, background: dotColor }}
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

/**
 * Map the engine's status string onto the three visual states. Only KNOWN
 * terminal statuses read as done/failed; anything unrecognized falls back to
 * 'running' so an in-flight task whose status string we don't know (e.g.
 * 'active', 'starting', 'queued') never renders as finished.
 */
function normalizeStatus(status: string): 'running' | 'failed' | 'done' {
  const s = status.toLowerCase();
  if (s === 'error' || s === 'failed' || s === 'failure' || s === 'cancelled' || s === 'canceled')
    return 'failed';
  if (s === 'success' || s === 'succeeded' || s === 'completed' || s === 'complete' || s === 'done' || s === 'ok')
    return 'done';
  return 'running';
}
