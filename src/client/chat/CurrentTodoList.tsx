import { useState } from 'react';
import { ChevronDown, ChevronUp, ListChecks } from 'lucide-react';
import type { TodoItem } from '@inharness-ai/agent-adapters';

interface Props {
  items: TodoItem[] | null;
}

const STATUS_GLYPH: Record<string, string> = {
  pending: '○',
  in_progress: '▶',
  completed: '✓',
  cancelled: '✕',
};

export function CurrentTodoList({ items }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!items || items.length === 0) return null;

  const total = items.length;
  const done = items.filter((i) => i.status === 'completed').length;
  const allDone = done === total;

  const activeItem =
    items.find((i) => i.status === 'in_progress') ??
    items.find((i) => i.status !== 'completed' && i.status !== 'cancelled') ??
    items[items.length - 1];

  const activeLabel = activeLabelOf(activeItem);
  const activeGlyph = STATUS_GLYPH[activeItem?.status ?? 'pending'] ?? '·';

  return (
    <div className="px-2.5 pt-2 pb-0.5" style={{ borderTop: '1px solid var(--c-hair)' }}>
      <div
        className="rounded-lg"
        style={{
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair-strong)',
        }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="current-todo-body"
          className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
          title={expanded ? 'Collapse TODO list' : 'Expand TODO list'}
        >
          <ListChecks size={12} style={{ color: 'var(--c-muted)', flexShrink: 0 }} />
          <span
            className="font-mono text-[12.5px] select-none"
            style={{
              color: allDone ? 'var(--c-green)' : 'var(--c-accent)',
              flexShrink: 0,
              minWidth: 28,
            }}
          >
            {activeGlyph}
          </span>
          <span
            className="flex-1 truncate text-[12.5px]"
            style={{
              color: allDone ? 'var(--c-muted)' : 'var(--c-ink)',
              fontWeight: allDone ? 400 : 500,
              textDecoration: allDone ? 'line-through' : 'none',
            }}
          >
            {allDone ? `All ${total} done` : activeLabel}
          </span>
          <span
            className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-mono"
            style={{
              background: allDone ? 'var(--c-green-soft, var(--c-panel))' : 'var(--c-panel)',
              color: allDone ? 'var(--c-green)' : 'var(--c-muted)',
              flexShrink: 0,
            }}
          >
            {done}/{total}
          </span>
          {expanded ? (
            <ChevronUp size={12} style={{ color: 'var(--c-muted)', flexShrink: 0 }} />
          ) : (
            <ChevronDown size={12} style={{ color: 'var(--c-muted)', flexShrink: 0 }} />
          )}
        </button>

        {expanded && (
          <ul
            id="current-todo-body"
            role="list"
            className="overflow-auto nice-scroll px-2 pb-2 pt-0.5"
            style={{
              maxHeight: '40vh',
              borderTop: '1px solid var(--c-hair)',
            }}
          >
            {items.map((item, idx) => (
              <TodoRow key={item.id ?? idx} item={item} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TodoRow({ item }: { item: TodoItem }) {
  const glyph = STATUS_GLYPH[item.status] ?? '·';
  const isDone = item.status === 'completed' || item.status === 'cancelled';
  const isActive = item.status === 'in_progress';
  const label = activeLabelOf(item);

  const glyphColor = isActive
    ? 'var(--c-accent)'
    : item.status === 'completed'
    ? 'var(--c-green)'
    : item.status === 'cancelled'
    ? 'var(--c-red)'
    : 'var(--c-muted)';

  return (
    <li className="flex items-start gap-2 py-1 text-[12.5px] leading-snug">
      <span
        className="font-mono select-none"
        style={{
          color: glyphColor,
          minWidth: 16,
          flexShrink: 0,
          paddingTop: 1,
        }}
      >
        {glyph}
      </span>
      <span
        className="flex-1 min-w-0 break-words"
        style={{
          color: isActive ? 'var(--c-ink)' : isDone ? 'var(--c-muted)' : 'var(--c-ink)',
          fontWeight: isActive ? 600 : 400,
          textDecoration: isDone ? 'line-through' : 'none',
        }}
      >
        {label}
      </span>
      {item.priority && (
        <span
          className="inline-flex items-center rounded px-1 py-0 text-[9.5px] font-mono uppercase tracking-wider"
          style={{
            background: priorityBg(item.priority),
            color: priorityColor(item.priority),
            flexShrink: 0,
          }}
          title={`priority: ${item.priority}`}
        >
          {item.priority}
        </span>
      )}
    </li>
  );
}

function activeLabelOf(item: TodoItem | undefined): string {
  if (!item) return '';
  if (item.status === 'in_progress' && item.activeForm?.trim()) return item.activeForm;
  return item.content;
}

function priorityBg(priority: string): string {
  if (priority === 'high') return 'var(--c-red-soft, var(--c-panel))';
  if (priority === 'medium') return 'var(--c-yellow, var(--c-panel))';
  return 'var(--c-panel)';
}

function priorityColor(priority: string): string {
  if (priority === 'high') return 'var(--c-red)';
  if (priority === 'medium') return 'var(--c-yellow-ink, var(--c-muted))';
  return 'var(--c-muted)';
}
