// @vitest-environment happy-dom
/**
 * M34/L12 — `ReferencesList` (group `detail`, `experimental`) against its
 * `ui-kit-component` record `references-list` (2.1.28): the referrers of an
 * entity rendered from props (`useReferences` feeds them), `LoadingState`
 * while loading, `EmptyState` for an empty list, no fetch of its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReferencesList, type ReferencesListItem, type ReferencesListProps } from './ReferencesList.js';
import type * as Published from '../../../plugin-types/ui.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

interface RecordReferencesListItem {
  pagePath: string;
  label: string;
  anchor?: string;
}
interface RecordReferencesListProps {
  references: RecordReferencesListItem[];
  onOpen?: (ref: RecordReferencesListItem) => void;
  loading?: boolean;
}

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
  vi.restoreAllMocks();
});

const mount = (props: ReferencesListProps) => act(() => root.render(createElement(ReferencesList, props)));

const REFS: ReferencesListItem[] = [
  { pagePath: 'modules/m13.md', label: 'M13 — Entity framework', anchor: 'm13l11sc' },
  { pagePath: 'layers/L12.md', label: 'L12 — Host UI Kit' },
];

describe('ReferencesList ↔ record `references-list` (M34/L12, 2.1.28)', () => {
  it('[entity:references-list] takes exactly the record props and the ReferencesListItem type (host and published /ui alike)', () => {
    const a: Same<ReferencesListProps, RecordReferencesListProps> = true;
    const b: Same<Published.ReferencesListProps, RecordReferencesListProps> = true;
    const c: Same<ReferencesListItem, RecordReferencesListItem> = true;
    const d: Same<Published.ReferencesListItem, RecordReferencesListItem> = true;
    expect([a, b, c, d]).toEqual([true, true, true, true]);
  });

  it('[entity:references-list] while loading renders the LoadingState; an empty list renders the EmptyState', () => {
    mount({ references: REFS, loading: true });
    expect(host.textContent).not.toContain('M13');
    // LoadingState: the skeleton bars, three of them.
    expect(host.querySelectorAll('.skeleton').length).toBe(3);
    expect(host.querySelector('li')).toBeNull();
    mount({ references: [] });
    expect(host.textContent).toContain('No references');
  });

  it('[ac:ac-komponent-referenceslist-m34-experi] renders the referrers from the references prop and opens one through onOpen, without fetching', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const onOpen = vi.fn();
    mount({ references: REFS, onOpen });
    const rows = Array.from(host.querySelectorAll('li'));
    expect(rows.map((r) => r.textContent)).toEqual(['M13 — Entity framework', 'L12 — Host UI Kit']);
    act(() => rows[0]!.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onOpen).toHaveBeenCalledWith(REFS[0]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
