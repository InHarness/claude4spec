import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { SuggestionProps } from '@tiptap/suggestion';
import type { SlashPaletteItem } from '../slashPalette.js';

export interface SlashCommand {
  /**
   * Command id. The generic XML-chip commands (`mention`, `element`, `list`,
   * `tagged`, `tagged-mixed`, `section`, `todo`) are host-owned; every other id
   * is contributed by the module that owns the type.
   *
   * 0.2.11 — the entity-type literals that used to be enumerated here are gone.
   * The union was already open (`| (string & {})`) so they carried no type
   * safety, only editor autocompletion — and the list they autocompleted named
   * `endpoint`, `dto` and `database-table`, types the host does not own, while
   * omitting whichever plugin types a project actually had.
   */
  id: string;
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

/**
 * The slash popover: fixed commands and command-source items (2.1.9). A source
 * item carrying an origin marker shows it beside its label — in the full view
 * and in a view narrowed to its source alike.
 */
export const SlashMenu = forwardRef<SlashMenuHandle, SuggestionProps<SlashPaletteItem>>(
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
        // A stable hook for the palette. Its rows are plain buttons in a
        // floating div, indistinguishable from the page's own buttons and list
        // items, so a test asserting "how many /dto entries are offered" — the
        // duplicate-command regression 0.2.2 shipped — could only guess at them
        // by text. Guessing produced a false failure and would just as happily
        // have produced a false pass.
        data-slash-menu=""
        className="rounded-md py-1"
        style={{
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair-strong)',
          minWidth: 280,
          // Plugin skills carry paragraph-long descriptions; without a cap the
          // palette stretches across the whole window.
          maxWidth: 'min(560px, calc(100vw - 16px))',
          maxHeight: 320,
          overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        }}
      >
        {props.items.map((item, i) => {
          const active = i === selected;
          return (
            <button
              key={item.key}
              onClick={() => run(i)}
            // Keep focus in the editor: a mousedown on the row would blur it
            // BEFORE the command runs, and an editor that saves on blur would
            // persist the half-typed `/men` query.
            onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSelected(i)}
              className="w-full flex items-center gap-3 px-3 py-1.5 text-left"
              style={{
                background: active ? 'var(--c-accent-soft)' : 'transparent',
                color: 'var(--c-ink)',
              }}
            >
              <span className="shrink-0 whitespace-nowrap font-mono text-[12.5px]" style={{ minWidth: 110 }}>
                {item.label}
                {item.origin ? (
                  <span
                    data-slash-origin=""
                    className="ml-1.5 rounded px-1 text-[10px] font-sans"
                    style={{ color: 'var(--c-subtle)', border: '1px solid var(--c-hair)' }}
                  >
                    {item.origin}
                  </span>
                ) : null}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-[12px]"
                style={{ color: 'var(--c-muted)' }}
                title={item.description}
              >
                {item.description}
              </span>
              {/* A source item's hint is its own trigger (`/skill-author` →
                  `skill-author`) — repeating the label adds nothing. Only an
                  argument hint (`/section` → `anchor`) is worth a column. */}
              {item.hint && `/${item.hint}` !== item.label ? (
                <span
                  className="shrink-0 truncate text-[10.5px] font-mono"
                  style={{ color: 'var(--c-subtle)', maxWidth: 120 }}
                >
                  {item.hint}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }
);
