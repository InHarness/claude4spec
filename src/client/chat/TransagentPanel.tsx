import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEventStream, useMessageReducer, batchToolBlocks } from '@inharness-ai/agent-chat';
import { ChevronDown, ChevronRight, Cpu } from 'lucide-react';
import { apiFetch } from '../lib/api-core.js';
import type { ChatMessage as ChatMessageRow, ChatSubagentTask } from '../../shared/entities.js';
import type { ChatModel } from '../state/chat.js';
import { BlockRenderer } from './BlockRenderer.js';
import { CHAT_ENDPOINTS, rowsToChatMessages, type TransagentEntry } from './useChat.js';

/**
 * 0.1.69 Transagents: nested child panel. On `transagent_started` the parent
 * panel renders one of these per child banka; it nested-live-joins
 * `GET /api/chat/stream/:childThreadId` (reusing the agent-chat resume
 * machinery). If the child is no longer live (completed / F5 after finish), it
 * falls back to the child's persisted history. Returns ONLY a summary to the
 * parent LLM — this panel is purely for the human to watch the child work.
 */
export function TransagentPanel({
  entry,
  model,
}: {
  entry: TransagentEntry;
  model: ChatModel;
}) {
  const { childThreadId, contextType, status } = entry;
  const [collapsed, setCollapsed] = useState(false);
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

  return (
    <div
      className="mb-3 rounded-lg overflow-hidden"
      style={{ border: '1px solid var(--c-accent)', background: 'var(--c-accent-soft)' }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono"
        style={{ color: 'var(--c-accent)' }}
        title={collapsed ? 'Expand transagent' : 'Collapse transagent'}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <Cpu size={12} />
        <span className="uppercase tracking-wider">transagent · {contextType}</span>
        <span className="flex-1" />
        {running ? (
          <span className="inline-flex items-center gap-1">
            <span className="dot-pulse">
              <span></span>
              <span></span>
              <span></span>
            </span>
            <span className="uppercase tracking-wider">running</span>
          </span>
        ) : (
          <span
            className="uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={
              status === 'error'
                ? { background: 'var(--c-red-soft)', color: 'var(--c-red)' }
                : { background: 'var(--c-green-soft)', color: 'var(--c-green)' }
            }
          >
            {status}
          </span>
        )}
      </button>
      {!collapsed && (
        <div
          className="px-2.5 py-2"
          style={{ background: 'var(--c-bg)', borderTop: '1px solid var(--c-hair)' }}
        >
          {displayMessages.length === 0 && (
            <div className="text-[11px] py-2" style={{ color: 'var(--c-subtle)' }}>
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
        </div>
      )}
    </div>
  );
}
