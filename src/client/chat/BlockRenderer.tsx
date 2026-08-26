import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Cpu, HelpCircle, ClipboardList, Clock, X } from 'lucide-react';
import type { UIContentBlock } from '@inharness-ai/agent-chat';
import type { UserInputRequest, UserInputResponse } from '@inharness-ai/agent-adapters';
import { SubagentPanel } from './SubagentPanel.js';
import { ToolCard, type ToolItem } from './ToolCard.js';
import { UserTextMarkdown } from './UserTextMarkdown.js';
import {
  BACKGROUND_TASK_TOOL_NAME,
  USER_INPUT_TOOL_NAME,
  WARNING_TOOL_NAME,
  type BackgroundTaskEntry,
} from './useChat.js';
import { BackgroundTaskPanel } from './BackgroundTaskPanel.js';
import { ChatMarkdown } from './ChatMarkdown.js';

export type BlockSide = 'user' | 'assistant';

interface Props {
  block: UIContentBlock;
  siblings: UIContentBlock[];
  side: BlockSide;
  annotations?: import('../../shared/entities.js').Annotation[];
  planMode?: boolean;
  /**
   * Live background-task registry, for the turn-level "Background tasks" block.
   * The carrier block stores only a `taskId`, because `_progress`/`_completed`
   * keep mutating the entry long after the block is placed — so the row is
   * looked up at render time rather than frozen into the block.
   */
  backgroundTasks?: BackgroundTaskEntry[];
}

export function BlockRenderer({
  block,
  siblings,
  side,
  annotations,
  planMode,
  backgroundTasks,
}: Props) {
  switch (block.type) {
    case 'text':
      return side === 'user' ? (
        <UserText text={block.text} annotations={annotations} planMode={planMode} />
      ) : (
        <AssistantText text={block.text} streaming={block.isStreaming} />
      );
    case 'thinking':
      return <ThinkingBlock text={block.text} streaming={block.isStreaming} />;
    case 'toolUse': {
      // Subagent-linked Task call: the standalone tool card is absorbed into the
      // sibling <SubagentPanel /> (its name/description/prompt live there now).
      if (siblings.some((b) => b.type === 'subagent' && b.toolUseId === block.toolUseId)) {
        return null;
      }
      const paired = siblings.find((b) => b.type === 'toolResult' && b.toolUseId === block.toolUseId);
      const result = paired && paired.type === 'toolResult' ? paired : null;
      if (block.toolName === WARNING_TOOL_NAME) {
        return <WarningBlock message={warningMessage(block.input)} />;
      }
      if (block.toolName === BACKGROUND_TASK_TOOL_NAME) {
        const taskId = backgroundTaskId(block.input);
        const entry = backgroundTasks?.find((t) => t.taskId === taskId);
        // No entry yet means the carrier outran its own state update; render
        // nothing this pass rather than an empty shell.
        return entry ? <BackgroundTaskPanel entry={entry} /> : null;
      }
      if (block.toolName === USER_INPUT_TOOL_NAME) {
        return (
          <PersistedUserInputCard
            request={block.input as UserInputRequest}
            responseContent={result?.content ?? null}
          />
        );
      }
      const item: ToolItem = {
        toolUseId: block.toolUseId,
        toolName: block.toolName,
        input: block.input,
        result: result ? { content: result.content, isError: result.isError } : null,
      };
      return <ToolCard items={[item]} />;
    }
    case 'toolResult':
      return null;
    case 'image':
      return null;
    case 'subagent': {
      // Pull the merged Task tool-call's input (the agent name + the prompt sent
      // to it) off the sibling toolUse block sharing this toolUseId. The subagent's
      // real answer is the sibling toolResult — `block.summary` is only the SDK's
      // task-notification blurb, not the returned output.
      const task = siblings.find((b) => b.type === 'toolUse' && b.toolUseId === block.toolUseId);
      const input = (task && task.type === 'toolUse' ? task.input : null) as
        | { subagent_type?: string; prompt?: string }
        | null;
      const res = siblings.find((b) => b.type === 'toolResult' && b.toolUseId === block.toolUseId);
      const result =
        res && res.type === 'toolResult' ? { content: res.content, isError: res.isError } : null;
      return (
        <SubagentPanel
          block={block}
          agentName={input?.subagent_type}
          prompt={input?.prompt}
          invocation={input ?? undefined}
          result={result}
        />
      );
    }
    case 'toolBatch': {
      // A warning is not a tool call and must never be folded into a tool card,
      // even when the batcher put it next to one. Pull the warnings out and hand
      // the remainder BACK to this switch rather than straight to <ToolCard> —
      // going straight there would strip the other special case below it, so a
      // warning batched next to a `__user_input__` would render the prompt as a
      // raw tool call and quietly make it non-interactive.
      if (block.items.some((i) => i.toolName === WARNING_TOOL_NAME)) {
        const warnings = block.items.filter((i) => i.toolName === WARNING_TOOL_NAME);
        const rest = block.items.filter((i) => i.toolName !== WARNING_TOOL_NAME);
        return (
          <>
            {warnings.map((item) => (
              <WarningBlock key={item.toolUseId} message={warningMessage(item.input)} />
            ))}
            {rest.length > 0 && (
              <BlockRenderer
                block={{ ...block, items: rest }}
                siblings={siblings}
                side={side}
                annotations={annotations}
                planMode={planMode}
                backgroundTasks={backgroundTasks}
              />
            )}
          </>
        );
      }
      // Same reasoning one carrier over: a background task is not a tool call,
      // so it must not be folded into a tool card when the batcher happens to
      // place it beside one. The remainder goes BACK through this switch so the
      // special cases below it survive.
      if (block.items.some((i) => i.toolName === BACKGROUND_TASK_TOOL_NAME)) {
        const tasks = block.items.filter((i) => i.toolName === BACKGROUND_TASK_TOOL_NAME);
        const rest = block.items.filter((i) => i.toolName !== BACKGROUND_TASK_TOOL_NAME);
        return (
          <>
            {tasks.map((item) => {
              const taskId = backgroundTaskId(item.input);
              const entry = backgroundTasks?.find((t) => t.taskId === taskId);
              return entry ? <BackgroundTaskPanel key={item.toolUseId} entry={entry} /> : null;
            })}
            {rest.length > 0 && (
              <BlockRenderer
                block={{ ...block, items: rest }}
                siblings={siblings}
                side={side}
                annotations={annotations}
                planMode={planMode}
                backgroundTasks={backgroundTasks}
              />
            )}
          </>
        );
      }
      if (block.items.every((i) => i.toolName === USER_INPUT_TOOL_NAME)) {
        return (
          <>
            {block.items.map((item) => (
              <PersistedUserInputCard
                key={item.toolUseId}
                request={item.input as UserInputRequest}
                responseContent={item.result?.content ?? null}
              />
            ))}
          </>
        );
      }
      const items: ToolItem[] = block.items.map((i) => ({
        toolUseId: i.toolUseId,
        toolName: i.toolName,
        input: i.input,
        result: i.result ? { content: i.result.content, isError: i.result.isError } : null,
      }));
      return <ToolCard items={items} />;
    }
    default:
      return null;
  }
}

// --- Runtime warning (C21) ---

/** The synthetic block carries `{ message }`; be forgiving about what arrives. */
function warningMessage(input: unknown): string {
  const message = (input as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.length > 0 ? message : String(input ?? '');
}

/**
 * A runtime warning is the ONLY channel telling the reader a guarantee got
 * weaker — an FS scope that fell back from a hard OS sandbox to a soft one, an
 * execute param the adapter architecture ignores. It must not read as assistant
 * prose, so it gets the yellow notice treatment (the annotation chip's palette)
 * rather than `--c-red*`, which stays reserved for errors: this is a live
 * caveat, not a failure.
 */
function WarningBlock({ message }: { message: string }) {
  return (
    <div className="msg-enter mb-4 flex gap-2">
      <div
        className="rounded-md px-3 py-2 text-[12.5px] max-w-[85%]"
        style={{ background: 'var(--c-yellow)', border: '1px solid rgba(0,0,0,0.08)' }}
      >
        <div
          className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider mb-1"
          style={{ color: 'var(--c-yellow-ink)' }}
        >
          <AlertTriangle size={11} />
          runtime warning
        </div>
        <div style={{ color: 'var(--c-ink)' }}>{message}</div>
      </div>
    </div>
  );
}

// --- User message ---

interface UserTextProps {
  text: string;
  annotations?: import('../../shared/entities.js').Annotation[];
  planMode?: boolean;
}

function UserText({ text, annotations, planMode }: UserTextProps) {
  return (
    <div className="msg-enter flex justify-end mb-4">
      <div className="max-w-[85%]">
        {annotations && annotations.length > 0 && (
          <div className="space-y-1.5 mb-1.5">
            {annotations.map((a, i) => (
              <div
                key={i}
                className="rounded-md px-2.5 py-1.5 text-[11.5px]"
                style={{ background: 'var(--c-yellow)', border: '1px solid rgba(0,0,0,0.08)' }}
              >
                <div
                  className="text-[10px] font-mono uppercase tracking-wider mb-0.5"
                  style={{ color: 'var(--c-yellow-ink)' }}
                >
                  annotation · {a.page}
                </div>
                <div className="font-serif italic" style={{ color: 'var(--c-yellow-ink)' }}>
                  "{a.text}"
                </div>
                {a.comment && (
                  <div className="mt-1" style={{ color: 'var(--c-ink)' }}>
                    {a.comment}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {planMode && (
          <div
            className="flex items-center gap-1 justify-end mb-1 text-[10.5px] font-mono uppercase tracking-wider"
            style={{ color: 'var(--c-muted)' }}
            title="Sent in Plan Mode — agent proposes, doesn't modify"
          >
            <ClipboardList size={10} />
            <span>plan mode</span>
          </div>
        )}
        <div
          className="rounded-xl rounded-tr-sm px-3 py-2 text-[13.5px] break-words"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
        >
          <UserTextMarkdown text={text} />
        </div>
      </div>
    </div>
  );
}

// --- Queued (pending) user message ---
//
// M05: a message typed during a live turn that is waiting in the queue (mid-turn
// push or after-turn merged dispatch). Mirrors the sent `UserText` bubble shape
// but rendered as a dimmed/dashed "ghost" so the contrast with delivered
// (solid) messages is immediate. Replaced by a solid bubble once delivered.

interface QueuedMessageBubbleProps {
  text: string;
  onCancel: () => void;
}

export function QueuedMessageBubble({ text, onCancel }: QueuedMessageBubbleProps) {
  return (
    <div className="msg-enter flex justify-end mb-4">
      <div className="max-w-[85%]">
        <div
          className="flex items-center gap-1 justify-end mb-1 text-[10.5px] font-mono uppercase tracking-wider"
          style={{ color: 'var(--c-muted)' }}
        >
          <Clock size={10} />
          <span>queued</span>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center justify-center rounded ml-0.5 hover:opacity-100"
            style={{ width: 14, height: 14, color: 'var(--c-muted)', background: 'transparent', opacity: 0.7 }}
            title="Cancel queued message"
            aria-label="Cancel queued message"
          >
            <X size={10} />
          </button>
        </div>
        <div
          className="rounded-xl rounded-tr-sm px-3 py-2 text-[13.5px] break-words"
          style={{
            background: 'var(--c-panel)',
            border: '1px dashed var(--c-hair-strong)',
            color: 'var(--c-muted)',
          }}
        >
          <UserTextMarkdown text={text} />
        </div>
      </div>
    </div>
  );
}

// --- Assistant text ---

interface AssistantTextProps {
  text: string;
  streaming: boolean;
}

function AssistantText({ text, streaming }: AssistantTextProps) {
  return (
    <div
      className="msg-enter chat-prose mb-3 break-words"
      style={{ color: 'var(--c-ink)' }}
    >
      <ChatMarkdown text={text} />
      {streaming && <span className="caret" />}
    </div>
  );
}

// --- Thinking block ---

interface ThinkingBlockProps {
  text: string;
  streaming: boolean;
}

function ThinkingBlock({ text, streaming }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 pr-2.5 py-1.5 text-[11.5px]"
        style={{ color: 'var(--c-muted)' }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Cpu size={11} />
        <span className="font-mono tracking-wider">Thinking{streaming ? ' · streaming' : ''}</span>
      </button>
      {open && (
        <div
          className="pb-2 font-serif italic text-[12.5px]"
          style={{ color: 'var(--c-muted)' }}
        >
          {text}
          {streaming && <span className="caret" />}
        </div>
      )}
    </div>
  );
}

function PersistedUserInputCard({
  request,
  responseContent,
}: {
  request: UserInputRequest;
  responseContent: string | null;
}) {
  const [open, setOpen] = useState(false);
  let response: UserInputResponse | null = null;
  if (responseContent) {
    try {
      response = JSON.parse(responseContent) as UserInputResponse;
    } catch {
      response = null;
    }
  }
  const actionColor =
    response?.action === 'accept'
      ? 'var(--c-green)'
      : response?.action === 'decline'
        ? 'var(--c-orange, #c99467)'
        : 'var(--c-subtle)';
  const actionLabel = response?.action ?? (responseContent ? 'answered' : 'pending');

  return (
    <div
      className="mb-3 rounded-lg overflow-hidden"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair-strong)' }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left"
        style={{ background: 'var(--c-panel)' }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <HelpCircle size={11} />
        <span className="font-mono text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
          user question · {request.origin}
        </span>
        <span className="flex-1" />
        <span className="text-[10.5px] font-mono uppercase" style={{ color: actionColor }}>
          {actionLabel}
        </span>
      </button>
      {!open && (
        <div className="px-3 py-2 text-[12.5px]" style={{ color: 'var(--c-ink)' }}>
          {request.questions[0]?.question ?? '(question)'}
        </div>
      )}
      {open && (
        <div className="px-3 py-2.5 space-y-3">
          {request.questions.map((q, i) => {
            const answer = response?.answers?.[i] ?? [];
            return (
              <div key={i}>
                <div
                  className="text-[10.5px] uppercase tracking-wider font-mono mb-1"
                  style={{ color: 'var(--c-subtle)' }}
                >
                  {q.header ?? `Q${i + 1}`}
                </div>
                <div className="text-[12.5px] mb-1.5" style={{ color: 'var(--c-ink)' }}>
                  {q.question}
                </div>
                {answer.length > 0 ? (
                  <ul className="space-y-0.5 pl-4" style={{ listStyleType: 'disc' }}>
                    {answer.map((a, j) => (
                      <li key={j} className="text-[12px]" style={{ color: 'var(--c-muted)' }}>
                        {a}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[12px] italic" style={{ color: 'var(--c-subtle)' }}>
                    (no answer)
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


/** The carrier block's payload is `{ taskId }` — read defensively; it round-trips through JSON. */
function backgroundTaskId(input: unknown): string | null {
  if (input && typeof input === 'object' && typeof (input as { taskId?: unknown }).taskId === 'string') {
    return (input as { taskId: string }).taskId;
  }
  return null;
}
