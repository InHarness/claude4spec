import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { SuggestionProps } from '@tiptap/suggestion';
import type { MentionSource } from '../registry.js';

export interface MentionMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export interface MentionMenuProps extends SuggestionProps<unknown> {
  source: MentionSource<unknown>;
}

export const MentionMenu = forwardRef<MentionMenuHandle, MentionMenuProps>(function MentionMenu(
  props,
  ref,
) {
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
        setSelected(
          (s) => (s - 1 + props.items.length) % Math.max(1, props.items.length),
        );
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (props.items.length > 0) {
          run(selected);
          return true;
        }
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
        No matches.
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
        const key = props.source.getItemKey ? props.source.getItemKey(item) : String(i);
        return (
          <button
            key={key}
            onClick={() => run(i)}
            onMouseEnter={() => setSelected(i)}
            style={{
              background: active ? 'var(--c-accent-soft)' : 'transparent',
              color: 'var(--c-ink)',
              padding: 0,
              border: 'none',
              display: 'block',
              width: '100%',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            {props.source.renderItem(item, active)}
          </button>
        );
      })}
    </div>
  );
});
