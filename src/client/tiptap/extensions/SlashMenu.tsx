import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { SuggestionProps } from '@tiptap/suggestion';

export interface SlashCommand {
  id:
    | 'mention'
    | 'element'
    | 'list'
    | 'tagged'
    | 'tagged-mixed'
    | 'endpoint'
    | 'dto'
    | 'database-table'
    | 'ui-view'
    | 'ac'
    | 'design-system'
    | 'todo'
    | 'diagram'
    | 'section'
    // M33: plugin-contributed command id (any string) — kept assignable
    // while preserving autocompletion of the known literals above.
    | (string & {});
  label: string;
  description: string;
  hint: string;
  /**
   * M33: when set, this is a declarative plugin command — invoking it
   * dispatches this popover kind generically (the editor framework owns
   * execution) instead of routing through the built-in `id` switch.
   */
  pluginPopoverKind?: string;
}

export interface SlashMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const SlashMenu = forwardRef<SlashMenuHandle, SuggestionProps<SlashCommand>>(
  function SlashMenu(props, ref) {
    const [selected, setSelected] = useState(0);

    useEffect(() => setSelected(0), [props.items]);

    const run = (index: number) => {
      const item = props.items[index];
      if (item) props.command(item);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
          setSelected((s) => (s + 1) % Math.max(1, props.items.length));
          return true;
        }
        if (event.key === 'ArrowUp') {
          setSelected((s) => (s - 1 + props.items.length) % Math.max(1, props.items.length));
          return true;
        }
        if (event.key === 'Enter') {
          run(selected);
          return true;
        }
        return false;
      },
    }));

    if (props.items.length === 0) {
      return (
        <div
          className="rounded-md py-2 px-3 text-[12px]"
          style={{
            background: 'var(--c-card)',
            border: '1px solid var(--c-hair-strong)',
            color: 'var(--c-subtle)',
            minWidth: 220,
          }}
        >
          No commands match.
        </div>
      );
    }

    return (
      <div
        className="rounded-md py-1"
        style={{
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair-strong)',
          minWidth: 280,
          maxHeight: 320,
          overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        }}
      >
        {props.items.map((item, i) => {
          const active = i === selected;
          return (
            <button
              key={item.id}
              onClick={() => run(i)}
              onMouseEnter={() => setSelected(i)}
              className="w-full flex items-center gap-3 px-3 py-1.5 text-left"
              style={{
                background: active ? 'var(--c-accent-soft)' : 'transparent',
                color: 'var(--c-ink)',
              }}
            >
              <span className="font-mono text-[12.5px]" style={{ minWidth: 110 }}>
                {item.label}
              </span>
              <span className="flex-1 text-[12px]" style={{ color: 'var(--c-muted)' }}>
                {item.description}
              </span>
              <span
                className="text-[10.5px] font-mono"
                style={{ color: 'var(--c-subtle)' }}
              >
                {item.hint}
              </span>
            </button>
          );
        })}
      </div>
    );
  }
);
