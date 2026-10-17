// @vitest-environment happy-dom
/**
 * 2.1.28 (the `ui-kit-component` record `diff-view`): non-empty `hunks` win
 * and render in `mode`; with no non-empty `hunks` a `before`/`after` pair
 * renders as two plain-text panes, with no add/del colours and no diffing;
 * with neither, the component renders its `EmptyState`, not an error.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DiffView, type DiffViewProps, type DiffViewLine } from './DiffView.js';
import type * as Published from '../../../plugin-types/ui.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(props: DiffViewProps) {
  await act(async () => {
    root.render(createElement(DiffView, props));
  });
}

/** The add/del row tints of the record's anatomy: the bridge tokens. */
const ADD_TINT = /var\(--c-green-soft\)/;
const DEL_TINT = /var\(--c-red-soft\)/;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The record's `types`: `DiffViewLine`. */
interface RecordDiffViewLine {
  op: 'add' | 'del' | 'ctx';
  line: string;
}
/** The record's `props`. */
interface RecordDiffViewProps {
  hunks?: RecordDiffViewLine[];
  before?: string;
  after?: string;
  title?: string;
  mode?: 'inline' | 'split';
}

/** The two plain-text panes of a before/after pair. */
const textPanes = () => host.querySelectorAll('[data-diff-pane="text"]');

/** Does any rendered element carry this tint in its inline style? */
function hasTint(tint: RegExp): boolean {
  return Array.from(host.querySelectorAll<HTMLElement>('*')).some((el) => tint.test(el.getAttribute('style') ?? ''));
}

/** Leaf text cells, in document order. */
function leafTexts(): string[] {
  return Array.from(host.querySelectorAll<HTMLElement>('*'))
    .filter((n) => n.children.length === 0)
    .map((n) => n.textContent ?? '');
}

describe('DiffView ↔ record `diff-view` (M34/L12, 2.1.28)', () => {
  it('[entity:diff-view] takes exactly the record props and the DiffViewLine type (host and published /ui alike)', () => {
    const a: Same<DiffViewProps, RecordDiffViewProps> = true;
    const b: Same<Published.DiffViewProps, RecordDiffViewProps> = true;
    const c: Same<DiffViewLine, RecordDiffViewLine> = true;
    const d: Same<Published.DiffViewLine, RecordDiffViewLine> = true;
    expect([a, b, c, d]).toEqual([true, true, true, true]);
  });

  it('[entity:diff-view] hunks render in the bridge code typography, add/del on --c-green-soft / --c-red-soft', async () => {
    await render({ hunks: [{ op: 'add', line: 'n' }, { op: 'del', line: 'o' }], title: 'Changes' });
    const style = host.innerHTML;
    expect(style).toContain('var(--font-mono)');
    expect(style).toContain('var(--text-code)');
    expect(hasTint(ADD_TINT)).toBe(true);
    expect(hasTint(DEL_TINT)).toBe(true);
    // No colour literal anywhere in the rendered markup.
    expect(style).not.toMatch(/rgba?\(|#[0-9a-f]{3,8}\b/i);
    expect(host.textContent).toContain('Changes');
  });
});

describe('DiffView with non-empty hunks (M34)', () => {
  it('[ac:ac-diffview-m34-experimental-renderuje-p] inline mode (default) renders the hunks in one column, coloured add/del with +/− markers', async () => {
    await render({
      hunks: [
        { op: 'ctx', line: 'same' },
        { op: 'del', line: 'old' },
        { op: 'add', line: 'new' },
      ],
    });
    const texts = leafTexts();
    expect(texts).toEqual(expect.arrayContaining(['same', 'old', 'new', '+', '−']));
    expect(hasTint(ADD_TINT)).toBe(true);
    expect(hasTint(DEL_TINT)).toBe(true);
    // One unified column: no split grid.
    expect(host.querySelector('.grid-cols-2')).toBeNull();
    expect(host.textContent).not.toContain('No differences');
  });

  it('[ac:ac-diffview-m34-experimental-renderuje-p] split mode renders the same hunks in two row-paired columns', async () => {
    await render({
      mode: 'split',
      hunks: [
        { op: 'ctx', line: 'same' },
        { op: 'del', line: 'old' },
        { op: 'add', line: 'new' },
      ],
    });
    const cols = host.querySelectorAll('.grid-cols-2 > div');
    expect(cols.length).toBe(2);
    expect(cols[0]!.textContent).toContain('old');
    expect(cols[0]!.textContent).not.toContain('new');
    expect(cols[1]!.textContent).toContain('new');
    expect(cols[1]!.textContent).not.toContain('old');
    expect(cols[0]!.textContent).toContain('same');
    expect(cols[1]!.textContent).toContain('same');
  });

  it('[ac:ac-diffview-z-niepustymi-hunks-i-jednocz] non-empty hunks together with a before/after pair render the hunks diff, not the pair', async () => {
    await render({ hunks: [{ op: 'add', line: 'from-hunks' }], before: 'pair-before', after: 'pair-after' });
    expect(host.textContent).toContain('from-hunks');
    expect(hasTint(ADD_TINT)).toBe(true);
    expect(host.textContent).not.toContain('pair-before');
    expect(host.textContent).not.toContain('pair-after');
    expect(textPanes().length).toBe(0);
  });
});

describe('DiffView with a before/after pair and no non-empty hunks (M34)', () => {
  it('[ac:ac-diffview-bez-niepustych-hunks-z-podan] renders the pair as two plain-text panes side by side, computing nothing and without add/del colours', async () => {
    // Two texts that DO differ: a component that diffed them would mark `b` as
    // removed and `c` as added. DiffView must show both texts verbatim instead.
    await render({ before: 'a\nb', after: 'a\nc' });

    const panes = textPanes();
    expect(panes.length).toBe(2);
    expect(panes[0]!.parentElement!.className).toContain('grid-cols-2');
    expect(Array.from(panes[0]!.children).map((c) => c.textContent)).toEqual(['a', 'b']);
    expect(Array.from(panes[1]!.children).map((c) => c.textContent)).toEqual(['a', 'c']);

    // No comparison: no add/del colours and no +/− markers anywhere.
    expect(hasTint(ADD_TINT)).toBe(false);
    expect(hasTint(DEL_TINT)).toBe(false);
    expect(leafTexts()).not.toContain('+');
    expect(leafTexts()).not.toContain('−');
  });

  it('[ac:ac-diffview-bez-niepustych-hunks-z-podan] empty hunks with a pair render the pair; mode does not apply to it', async () => {
    await render({ hunks: [], before: 'b', after: 'a', mode: 'inline' });
    expect(host.textContent).not.toContain('No differences');
    // Still two panes, even in `inline` mode.
    expect(textPanes().length).toBe(2);
    expect(hasTint(ADD_TINT)).toBe(false);
  });

  it('[ac:ac-diffview-bez-niepustych-hunks-z-podan-2] only `before` (half a pair) renders the EmptyState, not an error', async () => {
    await render({ hunks: [], before: 'only-before' });
    expect(host.textContent).toContain('No differences');
    expect(host.textContent).not.toContain('only-before');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('[ac:ac-diffview-bez-niepustych-hunks-z-podan-2] only `after` (half a pair) renders the EmptyState, not an error', async () => {
    await render({ after: 'only-after' });
    expect(host.textContent).toContain('No differences');
    expect(host.textContent).not.toContain('only-after');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('DiffView with nothing to render (M34)', () => {
  it('[ac:ac-diffview-z-pustym-propsem-hunks-renderuj] with neither hunks nor a pair renders the EmptyState, not an error', async () => {
    await render({});
    expect(host.textContent).toContain('No differences');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('[ac:ac-diffview-z-pustym-propsem-hunks-renderuj] empty hunks without a pair render the EmptyState', async () => {
    await render({ hunks: [] });
    expect(host.textContent).toContain('No differences');
    expect(host.querySelector('.grid-cols-2')).toBeNull();
  });
});
