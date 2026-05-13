import { useState } from 'react';
import {
  Box,
  Braces,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Database,
  FileEdit,
  FileText,
  Network,
  Search,
  Tag,
  Terminal,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { getRenderer, parseToolResult, prettyToolName } from './toolRenderers.js';
import { ToolJsonModal } from './ToolJsonModal.js';
import { localToolCategory, type LocalToolCategory } from './toolCategoryLocal.js';

export interface ToolItem {
  toolUseId: string;
  toolName: string;
  input: unknown;
  result?: { content: string; isError: boolean } | null;
}

interface Props {
  items: ToolItem[];
}

export function ToolCard({ items }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);

  if (items.length === 0) return null;
  const first = items[0]!;

  const category = localToolCategory(first.toolName);
  const Icon = categoryIcon(category);
  const iconColor = categoryColor(category);
  const displayName = prettyToolName(first.toolName);

  const anyRunning = items.some((i) => !i.result);
  const anyError = items.some((i) => i.result?.isError);
  const status: 'running' | 'error' | 'done' = anyError
    ? 'error'
    : anyRunning
      ? 'running'
      : 'done';

  const isBatch = items.length > 1;

  return (
    <>
      <div
        className="mb-3 rounded-lg overflow-hidden"
        style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair-strong)' }}
      >
        <div
          className="w-full flex items-center gap-2 px-2 py-1 text-[12px] text-left"
          style={{ background: 'var(--c-panel)' }}
        >
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <Icon size={12} style={{ color: iconColor }} />
            <span
              className="font-mono text-[11.5px] truncate"
              style={{ color: 'var(--c-ink)' }}
            >
              {displayName}
            </span>
            {isBatch && (
              <span
                className="font-mono text-[10.5px]"
                style={{ color: 'var(--c-subtle)' }}
                title={`${items.length} tool calls`}
              >
                × {items.length}
              </span>
            )}
          </button>
          {status === 'running' ? (
            <span className="dot-pulse" aria-label="running">
              <span></span>
              <span></span>
              <span></span>
            </span>
          ) : status === 'error' ? (
            <span
              className="rounded-full"
              style={{ width: 7, height: 7, background: 'var(--c-red)' }}
              aria-label="error"
            />
          ) : null}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setJsonOpen(true);
            }}
            aria-label="Show raw JSON"
            title="Show raw JSON"
            className="tool-json-btn inline-flex items-center justify-center rounded"
            style={{ width: 22, height: 22, color: 'var(--c-subtle)' }}
          >
            <Braces size={13} />
          </button>
        </div>
        {expanded && (
          <div
            className={items.length > 5 ? 'px-3 py-2 scroll-thin' : 'px-3 py-2'}
            style={{
              maxHeight: items.length > 5 ? '60vh' : undefined,
              overflowY: items.length > 5 ? 'auto' : undefined,
            }}
          >
            {items.map((item, idx) => (
              <ToolItemBody
                key={item.toolUseId}
                item={item}
                showSeparator={isBatch && idx > 0}
              />
            ))}
          </div>
        )}
      </div>
      {jsonOpen && (
        <ToolJsonModal
          title={isBatch ? `${displayName} × ${items.length}` : first.toolName}
          items={items.map((i) => ({
            toolName: i.toolName,
            input: i.input,
            result: i.result ? parseToolResult(i.result.content) : null,
            isError: i.result?.isError ?? false,
          }))}
          onClose={() => setJsonOpen(false)}
        />
      )}
    </>
  );
}

interface ToolItemBodyProps {
  item: ToolItem;
  showSeparator: boolean;
}

function ToolItemBody({ item, showSeparator }: ToolItemBodyProps) {
  const renderer = getRenderer(item.toolName);
  const parsed = item.result ? parseToolResult(item.result.content) : null;
  const hasCustomInput = typeof renderer?.renderInput === 'function';
  const summaryText = renderer?.summary(item.input, parsed) ?? prettyToolName(item.toolName);

  return (
    <div
      style={{
        paddingTop: showSeparator ? 6 : 0,
        marginTop: showSeparator ? 6 : 0,
        borderTop: showSeparator ? '1px solid var(--c-hair)' : undefined,
      }}
    >
      {hasCustomInput ? (
        renderer!.renderInput!(item.input, parsed)
      ) : (
        <div
          className="text-[12.5px] font-mono flex gap-2"
          style={{ color: 'var(--c-ink)' }}
        >
          <span style={{ color: 'var(--c-subtle)' }}>·</span>
          <span className="break-words">{summaryText}</span>
        </div>
      )}
    </div>
  );
}

function categoryIcon(category: LocalToolCategory): LucideIcon {
  switch (category) {
    case 'edit':
      return FileEdit;
    case 'read':
      return FileText;
    case 'search':
      return Search;
    case 'shell':
      return Terminal;
    case 'task':
      return Workflow;
    case 'mcp-endpoint':
      return Network;
    case 'mcp-dto':
      return Box;
    case 'mcp-database':
      return Database;
    case 'mcp-reference':
      return Tag;
    case 'mcp-plan':
      return ClipboardList;
    case 'other':
      return Wrench;
  }
}

function categoryColor(category: LocalToolCategory): string {
  switch (category) {
    case 'edit':
      return 'var(--c-accent)';
    case 'read':
      return 'var(--c-muted)';
    case 'search':
      return 'var(--c-muted)';
    case 'shell':
      return 'var(--c-ink)';
    case 'task':
      return 'var(--c-accent)';
    case 'mcp-endpoint':
    case 'mcp-dto':
    case 'mcp-database':
    case 'mcp-reference':
    case 'mcp-plan':
      return 'var(--c-accent)';
    case 'other':
      return 'var(--c-subtle)';
  }
}
