// @vitest-environment happy-dom
/**
 * 2.1.26 (M34 `m34l12sc` / L12 `d97023iq` — `DiffView`): non-empty `hunks` win
 * and render in `mode`; with no non-empty `hunks` a `before`/`after` pair
 * renders as two plain-text panes, with no add/del colours and no diffing;
 * with neither, the component renders its `EmptyState`, not an error.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DiffView, type DiffViewProps } from './DiffView.js';

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

/** The add/del row tints `stylesFor` applies (matched loosely: the DOM may re-serialise `0.10` as `0.1`). */
const ADD_TINT = /rgba\(\s*16,\s*185,\s*129/;
const DEL_TINT = /rgba\(\s*220,\s*38,\s*38/;

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

describe('DiffView (M34, experimental)', () => {
  it('[ac:ac-diffview-m34-experimental-renderuje-p] renders the injected hunks as given, coloured add/del with +/− markers', async () => {
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
    expect(host.textContent).not.toContain('No differences');
  });

  it('[ac:ac-diffview-m34-experimental-renderuje-p] renders a before/after pair as two plain-text panes and computes nothing', async () => {
    // Two texts that DO differ: a component that diffed them would mark `b` as
    // removed and `c` as added. DiffView must show both texts verbatim instead.
    await render({ before: 'a\nb', after: 'a\nc' });

    const panes = host.querySelectorAll('.grid-cols-2 > div');
    expect(panes.length).toBe(2);
    expect(Array.from(panes[0]!.children).map((c) => c.textContent)).toEqual(['a', 'b']);
    expect(Array.from(panes[1]!.children).map((c) => c.textContent)).toEqual(['a', 'c']);

    // No comparison: no add/del colours and no +/− markers anywhere.
    expect(hasTint(ADD_TINT)).toBe(false);
    expect(hasTint(DEL_TINT)).toBe(false);
    expect(leafTexts()).not.toContain('+');
    expect(leafTexts()).not.toContain('−');
  });

  it('[ac:ac-diffview-m34-experimental-renderuje-p] non-empty hunks take precedence over a before/after pair', async () => {
    await render({ hunks: [{ op: 'add', line: 'from-hunks' }], before: 'pair-before', after: 'pair-after' });
    expect(host.textContent).toContain('from-hunks');
    expect(host.textContent).not.toContain('pair-before');
    expect(host.textContent).not.toContain('pair-after');
  });

  it('[ac:ac-diffview-m34-experimental-renderuje-p] mode does not apply to the before/after pair', async () => {
    await render({ before: 'x', after: 'y', mode: 'inline' });
    // Still two panes, even in `inline` mode.
    expect(host.querySelectorAll('.grid-cols-2 > div').length).toBe(2);
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

  it('[ac:ac-diffview-z-pustym-propsem-hunks-renderuj] half a pair is not a pair — EmptyState', async () => {
    await render({ hunks: [], before: 'only-before' });
    expect(host.textContent).toContain('No differences');
    expect(host.textContent).not.toContain('only-before');
  });

  it('[ac:ac-diffview-z-pustym-propsem-hunks-renderuj] empty hunks WITH a pair render the pair, not the EmptyState', async () => {
    await render({ hunks: [], before: 'b', after: 'a' });
    expect(host.textContent).not.toContain('No differences');
    expect(host.querySelectorAll('.grid-cols-2 > div').length).toBe(2);
  });
});
