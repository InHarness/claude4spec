import { useState } from 'react';
import { ChevronDown, ChevronRight, Workflow, Braces } from 'lucide-react';
import type { UIContentBlock, ChatMessageType } from '@inharness-ai/agent-chat';
import { BlockRenderer } from './BlockRenderer.js';
import { ChatMarkdown } from './ChatMarkdown.js';
import { ToolJsonModal } from './ToolJsonModal.js';
import { parseToolResult } from './toolRenderers.js';

interface Props {
  block: Extract<UIContentBlock, { type: 'subagent' }>;
  /** Subagent name from the merged Task tool-call (`subagent_type`). */
  agentName?: string;
  /** Full prompt the parent sent to the subagent (merged Task tool-call). */
  prompt?: string;
  /** Full Task tool-call input, for the raw-JSON modal. */
  invocation?: unknown;
  /** The subagent's returned output (Task tool_result) — the real answer. */
  result?: { content: string; isError: boolean } | null;
}

export function SubagentPanel({ block, agentName, prompt, invocation, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const status = normalizeStatus(block.status);
  const dotColor =
    status === 'running'
      ? 'var(--c-blue, #5b8bc7)'
      : status === 'failed'
        ? 'var(--c-red, #c45a3b)'
        : 'var(--c-green, #4a9860)';
  const nestedCount = block.messages?.length ?? 0;
  const [promptOpen, setPromptOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  // The real answer is the Task tool_result; `block.summary` is only the SDK's
  // task-notification blurb (kept as a fallback for older threads with no result).
  // The adapter JSON-wraps array tool_result content (`[{type:'text',text}]`);
  // parseToolResult peels that back to the inner text (or parsed MCP-JSON).
  const rawAnswer = result ? parseToolResult(result.content) : block.summary ?? null;
  const answerText =
    typeof rawAnswer === 'string'
      ? rawAnswer
      : rawAnswer != null
        ? JSON.stringify(rawAnswer, null, 2)
        : null;
  const answerIsText = typeof rawAnswer === 'string';
  // `block.description` is overwritten by subagent_progress (last activity); the
  // original call description lives on the Task invocation input.
  const taskDescription =
    (invocation as { description?: string } | undefined)?.description ?? block.description;

  return (
    <div
      className="mb-3 rounded-lg overflow-hidden"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair-strong)' }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left"
        style={{ background: 'var(--c-panel)' }}
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Workflow size={12} style={{ color: 'var(--c-accent)' }} />
        <span
          className="font-mono text-[11px] uppercase tracking-wider whitespace-nowrap"
          style={{ color: 'var(--c-subtle)' }}
        >
          {agentName ?? 'subagent'}
        </span>
        <span
          className="truncate text-[12px]"
          style={{ color: 'var(--c-ink)', fontWeight: 500, minWidth: 0 }}
          title={taskDescription}
        >
          {taskDescription}
        </span>
        <span className="flex-1" />
        {nestedCount > 0 && (
          <span
            className="font-mono text-[10.5px]"
            style={{ color: 'var(--c-subtle)' }}
            title={`${nestedCount} internal message${nestedCount === 1 ? '' : 's'}`}
          >
            {nestedCount}
          </span>
        )}
        {status === 'running' ? (
          <span className="dot-pulse">
            <span></span>
            <span></span>
            <span></span>
          </span>
        ) : (
          <span
            className="rounded-full"
            style={{ width: 7, height: 7, background: dotColor }}
            title={status}
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
          {taskDescription && (
            <div className="mb-2">
              <div
                className="text-[10.5px] uppercase tracking-wider font-mono mb-1"
                style={{ color: 'var(--c-subtle)' }}
              >
                Description
              </div>
              <div className="text-[12.5px]" style={{ color: 'var(--c-ink)' }}>
                {taskDescription}
              </div>
            </div>
          )}
          {prompt && (
            <div className="mb-2">
              <button
                onClick={() => setPromptOpen((v) => !v)}
                className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider font-mono"
                style={{ color: 'var(--c-subtle)' }}
              >
                {promptOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                Prompt
              </button>
              {promptOpen && (
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
                  {prompt}
                </pre>
              )}
            </div>
          )}
          {nestedCount === 0 && (
            <div className="text-[11.5px] italic" style={{ color: 'var(--c-subtle)' }}>
              {status === 'running' ? 'Running…' : 'No nested output.'}
            </div>
          )}
          {(block.messages ?? []).map((msg: ChatMessageType) => (
            <div key={msg.id}>
              {msg.blocks.map((b: UIContentBlock, i: number) => (
                <BlockRenderer key={i} block={b} siblings={msg.blocks} side={msg.role} />
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
                    style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
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
          title={agentName ?? 'subagent'}
          items={[
            {
              toolName: agentName ?? 'Task',
              input: invocation ?? { description: taskDescription, prompt },
              result: result ? parseToolResult(result.content) : null,
              isError: result?.isError ?? false,
            },
          ]}
          onClose={() => setJsonOpen(false)}
        />
      )}
    </div>
  );
}

function normalizeStatus(raw: string): 'running' | 'completed' | 'failed' {
  const s = raw.toLowerCase();
  if (s === 'running' || s === 'in_progress' || s === 'in-progress') return 'running';
  if (s === 'failed' || s === 'error') return 'failed';
  return 'completed';
}
