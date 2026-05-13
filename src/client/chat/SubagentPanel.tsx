import { useState } from 'react';
import { ChevronDown, ChevronRight, Workflow } from 'lucide-react';
import type { UIContentBlock, ChatMessageType } from '@inharness-ai/agent-chat';
import { BlockRenderer } from './BlockRenderer.js';

interface Props {
  block: Extract<UIContentBlock, { type: 'subagent' }>;
}

export function SubagentPanel({ block }: Props) {
  const [expanded, setExpanded] = useState(false);
  const status = normalizeStatus(block.status);
  const dotColor =
    status === 'running'
      ? 'var(--c-blue, #5b8bc7)'
      : status === 'failed'
        ? 'var(--c-red, #c45a3b)'
        : 'var(--c-green, #4a9860)';
  const nestedCount = block.messages?.length ?? 0;

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
        <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--c-subtle)' }}>
          subagent
        </span>
        <span
          className="truncate text-[12px]"
          style={{ color: 'var(--c-ink)', fontWeight: 500, minWidth: 0 }}
          title={block.description}
        >
          {block.description}
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
      </button>

      {!expanded && block.summary && (
        <div className="px-3 py-2 text-[12.5px]" style={{ color: 'var(--c-muted)' }}>
          {block.summary}
        </div>
      )}

      {expanded && (
        <div className="px-3 py-2.5">
          {nestedCount === 0 && (
            <div className="text-[11.5px] italic" style={{ color: 'var(--c-subtle)' }}>
              {status === 'running' ? 'Running…' : 'No nested output.'}
            </div>
          )}
          {nestedCount > 0 && (
            <div
              className="rounded-md px-2 py-2"
              style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
            >
              {(block.messages ?? []).map((msg: ChatMessageType) => (
                <div key={msg.id}>
                  {msg.blocks.map((b: UIContentBlock, i: number) => (
                    <BlockRenderer key={i} block={b} siblings={msg.blocks} side={msg.role} />
                  ))}
                </div>
              ))}
            </div>
          )}
          {block.summary && (
            <div
              className="mt-2 rounded-md px-2.5 py-2 text-[12.5px]"
              style={{
                background: 'var(--c-green-soft, rgba(74, 152, 96, 0.12))',
                border: `1px solid ${dotColor}`,
                color: 'var(--c-ink)',
              }}
            >
              <div
                className="text-[10px] uppercase tracking-wider font-mono mb-1"
                style={{ color: 'var(--c-subtle)' }}
              >
                Summary
              </div>
              {block.summary}
            </div>
          )}
        </div>
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
