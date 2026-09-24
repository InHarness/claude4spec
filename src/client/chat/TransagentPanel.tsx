import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEventStream, useMessageReducer, batchToolBlocks } from '@inharness-ai/agent-chat';
import { Braces, ChevronDown, ChevronRight, Cpu } from 'lucide-react';
import { apiFetch } from '../lib/api-core.js';
import type { ChatMessage as ChatMessageRow, ChatSubagentTask } from '../../shared/entities.js';
import type { ChatModel } from '../state/chat.js';
import { BlockRenderer } from './BlockRenderer.js';
import { ChatMarkdown } from './ChatMarkdown.js';
import { ToolJsonModal } from './ToolJsonModal.js';
import { parseToolResult } from './toolRenderers.js';
import { CHAT_ENDPOINTS, rowsToChatMessages, type TransagentEntry } from './useChat.js';

/**
 * 0.1.69 Transagents: nested child panel. On `transagent_started` the parent
 * panel renders one of these per child banka; it nested-live-joins
 * `GET /api/chat/stream/:childThreadId` (reusing the agent-chat resume
 * machinery). If the child is no longer live (completed / F5 after finish), it
 * falls back to the child's persisted history. Returns ONLY a summary to the
 * parent LLM — this panel is purely for the human to watch the child work.
 *
 * Rendered by <BlockRenderer /> IN PLACE of the parent's `tool_use(runTransagent)`
 * card (the call is absorbed, like a Task call into <SubagentPanel />), and in
 * SubagentPanel's shell — same data source split, one visual family (M46).
 */
export function TransagentPanel({
  entry,
  model,
  invocation,
  result,
}: {
  entry: TransagentEntry;
  model: ChatModel;
  /** The `runTransagent` call input (`contextType`, `message`, `payload`, …). */
  invocation?: unknown;
  /** The call's tool_result — the summary handed back to the parent LLM. */
  result?: { content: string; isError: boolean } | null;
}) {
  const { toolUseId, childThreadId, contextType, status } = entry;
  // Open while the child works so the human watches it live; the user folds it.
  const [expanded, setExpanded] = useState(status === 'running');
  const [messageOpen, setMessageOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const { state, handleWireEvent, restoreMessages, clear } = useMessageReducer('claude-code', model);

  const onEvent = useCallback((event: Parameters<typeof handleWireEvent>[0]) => {
    handleWireEvent(event);
  }, [handleWireEvent]);
  const noop = useCallback(() => {}, []);

  const { joinStream, disconnect } = useEventStream({
    serverUrl: '',
    endpoints: CHAT_ENDPOINTS,
    onEvent,
    onError: noop,
    onConnected: noop,
  });

  useEffect(() => {
    let cancelled = false;
    clear();
    (async () => {
      // Try the live nested join first; a completed/absent child returns false.
      const joined = await joinStream(childThreadId).catch(() => false);
      if (cancelled || joined) return;
      // Not live → render the child's persisted history.
      try {
        const res = await apiFetch(`/api/threads/${childThreadId}`);
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as {
          data: { messages: ChatMessageRow[]; subagentTasks?: ChatSubagentTask[]; lastSessionId?: string | null };
        };
        const t = payload.data;
        restoreMessages(
          rowsToChatMessages(t.messages, t.subagentTasks ?? []),
          t.lastSessionId ?? undefined,
          'claude-code',
          model,
          [],
        );
      } catch {
        /* best-effort — leave the panel empty */
      }
    })();
    return () => {
      cancelled = true;
      disconnect();
    };
    // Re-join only when the child changes. `status` flips via the parent's
    // transagent_completed but the live stream already finalizes itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childThreadId]);

  const displayMessages = useMemo(
    () => state.messages.map((msg) => ({ ...msg, blocks: batchToolBlocks(msg.blocks) })),
    [state.messages],
  );

  const running = status === 'running';
  const dotColor =
    status === 'error' ? 'var(--c-red, #c45a3b)' : 'var(--c-green, #4a9860)';
  const input = (invocation ?? null) as { message?: unknown; payload?: unknown } | null;
  const message = typeof input?.message === 'string' ? input.message : undefined;
  const payload = input?.payload && typeof input.payload === 'object' ? input.payload : undefined;
  // Same unwrapping as SubagentPanel: the adapter JSON-wraps tool_result content;
  // `entry.summary` (from `transagent_completed`) covers a result not yet paired.
  // runTransagent answers with a `{ threadId, summary }` envelope — show the summary.
  const parsed = result ? parseToolResult(result.content) : entry.summary ?? null;
  const envelopeSummary = (parsed as { summary?: unknown } | null)?.summary;
  const rawAnswer =
    parsed && typeof parsed === 'object' && typeof envelopeSummary === 'string' ? envelopeSummary : parsed;
  const answerText =
    typeof rawAnswer === 'string'
      ? rawAnswer
      : rawAnswer != null
        ? JSON.stringify(rawAnswer, null, 2)
        : null;
  const answerIsText = typeof rawAnswer === 'string';

  return (
    <div
      className="mb-3 rounded-lg overflow-hidden"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair-strong)' }}
      data-transagent-panel={toolUseId}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left"
        style={{ background: 'var(--c-panel)' }}
        title={expanded ? 'Collapse transagent' : 'Expand transagent'}
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Cpu size={12} style={{ color: 'var(--c-accent)' }} />
        <span
          className="font-mono text-[11px] uppercase tracking-wider whitespace-nowrap"
          style={{ color: 'var(--c-subtle)' }}
        >
          transagent · {contextType}
        </span>
        {message && (
          <span
            className="truncate text-[12px]"
            style={{ color: 'var(--c-ink)', fontWeight: 500, minWidth: 0 }}
            title={message}
          >
            {message}
          </span>
        )}
        <span className="flex-1" />
        {running ? (
          <span className="dot-pulse" title="running">
            <span></span>
            <span></span>
            <span></span>
          </span>
        ) : (
          <span
            className="rounded-full"
            style={{ width: 7, height: 7, background: dotColor }}
            title={status}
            data-status={status}
          />
        )}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            setJsonOpen(true);
          }}
          aria-label="Show raw JSON"
          title="Show raw JSON"
          className="tool-json-btn inline-flex items-center justify-center rounded"
          style={{ width: 22, height: 22, color: 'var(--c-subtle)' }}
        >
          <Braces size={12} />
        </span>
      </button>

      {!expanded && answerText && (
        <div className="px-3 py-2 text-[12.5px] line-clamp-3" style={{ color: 'var(--c-muted)' }}>
          {answerText}
        </div>
      )}

      {expanded && (
        <div className="px-3 py-2.5">
          {(message || payload) && (
            <div className="mb-2">
              <button
                type="button"
                onClick={() => setMessageOpen((v) => !v)}
                className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider font-mono"
                style={{ color: 'var(--c-subtle)' }}
              >
                {messageOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                Message
              </button>
              {messageOpen && (
                <pre
                  className="font-mono text-[11.5px] scroll-thin mt-1"
                  style={{
                    background: 'var(--c-panel)',
                    color: 'var(--c-ink)',
                    padding: '6px 8px',
                    borderRadius: 4,
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 220,
                    overflow: 'auto',
                  }}
                >
                  {message}
                  {payload ? `${message ? '\n\n' : ''}payload: ${JSON.stringify(payload, null, 2)}` : ''}
                </pre>
              )}
            </div>
          )}
          {displayMessages.length === 0 && (
            <div className="text-[11.5px] italic" style={{ color: 'var(--c-subtle)' }}>
              {running ? 'Child agent is working…' : 'No activity recorded.'}
            </div>
          )}
          {displayMessages.map((msg) => (
            <div key={msg.id}>
              {msg.blocks.map((block, i) => (
                <BlockRenderer key={i} block={block} siblings={msg.blocks} side={msg.role} />
              ))}
            </div>
          ))}
          {answerText && (
            <div className="mt-2">
              <div
                className="text-[10.5px] uppercase tracking-wider font-mono mb-1"
                style={{ color: 'var(--c-subtle)' }}
              >
                Summary
              </div>
              <div
                className="rounded-md px-2.5 py-2 text-[12.5px] scroll-thin"
                style={{
                  background: 'var(--c-panel)',
                  border: '1px solid var(--c-hair)',
                  color: 'var(--c-ink)',
                  maxHeight: 360,
                  overflowY: 'auto',
                }}
              >
                {answerIsText ? (
                  <ChatMarkdown text={answerText} />
                ) : (
                  <pre
                    className="font-mono text-[11.5px]"
                    style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    {answerText}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {jsonOpen && (
        <ToolJsonModal
          title={`transagent · ${contextType}`}
          items={[
            {
              toolName: 'runTransagent',
              input: invocation ?? { contextType },
              result: result ? parseToolResult(result.content) : entry.summary ?? null,
              isError: result?.isError ?? status === 'error',
            },
          ]}
          onClose={() => setJsonOpen(false)}
        />
      )}
    </div>
  );
}
