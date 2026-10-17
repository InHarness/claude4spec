// @vitest-environment happy-dom
/**
 * 2.1.28 — M13 `chipprops`: a chip's click handler calls only the
 * `editorBridge` singleton re-exported from `@c4s/plugin-runtime`. For
 * `<SectionRefChip />` that is `editorBridge.openSection(page_path, anchor)`;
 * the bridge of the nearest provider decides the navigation. Alt+click stays
 * with the node view's edit popover. Entity chips get `editorBridge.openEntity`
 * through the host resolver's `onOpen`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const nav = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => (opts: unknown) => {
    nav.calls.push(opts);
    return Promise.resolve();
  },
}));
const data = vi.hoisted(() => ({
  section: { anchor: 'abc12345', rootId: 'pages', pagePath: 'guide/intro.md', headingText: 'Intro' } as unknown,
  plan: undefined as unknown,
}));
vi.mock('../hooks/useSection.js', () => ({ useSection: () => ({ data: data.section, isLoading: false }) }));
vi.mock('../hooks/usePlanByAnchor.js', () => ({ usePlanByAnchor: () => ({ data: data.plan }) }));
const endpointModule = { type: 'endpoint', pathPrefix: '/endpoints', routes: {}, detailPanel: () => null };
vi.mock('../core/plugin-host/host.js', () => ({
  clientPluginHost: { getEntity: (t: string) => (t === 'endpoint' ? endpointModule : null) },
}));

import { SectionRefChipWithData } from './SectionRefChipWithData.js';
import { EditorBridgeProvider, type EditorBridge } from '../tiptap/EditorContext.js';
import { editorBridge } from '../runtime/editor-bridge.js';
import { openEntityHandler } from '../entities/openEntity.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let calls: string[][];
const bridge: EditorBridge = {
  openEntity: (type, slug) => calls.push(['entity', type, slug]),
  openSection: (pagePath, anchor) => calls.push(['section', pagePath, anchor]),
};

beforeEach(() => {
  calls = [];
  nav.calls = [];
  data.plan = undefined;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function chipEl(): HTMLElement {
  const el = host.querySelector<HTMLElement>('[data-section-anchor="abc12345"]');
  expect(el).not.toBeNull();
  return el!;
}

describe('chip click handlers go through the editorBridge singleton', () => {
  it('[section:chipprops] SectionRefChip: a click calls editorBridge.openSection(page_path, anchor), reaching the surrounding provider\'s bridge — no router call of its own', () => {
    act(() =>
      root.render(createElement(EditorBridgeProvider, { bridge, children: createElement(SectionRefChipWithData, { anchor: 'abc12345' }) })),
    );
    act(() => chipEl().click());
    expect(calls).toEqual([['section', 'guide/intro.md', 'abc12345']]);
    expect(nav.calls).toEqual([]);
  });

  it('[section:chipprops] SectionRefChip: alt+click navigates nowhere (it belongs to the node view\'s edit popover)', () => {
    act(() =>
      root.render(createElement(EditorBridgeProvider, { bridge, children: createElement(SectionRefChipWithData, { anchor: 'abc12345' }) })),
    );
    act(() => {
      chipEl().dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
    });
    expect(calls).toEqual([]);
    expect(nav.calls).toEqual([]);
  });

  it('[section:chipprops] an entity chip of a type with a detail route gets an onOpen that calls editorBridge.openEntity(type, slug) and nothing else', () => {
    const spy = vi.spyOn(editorBridge, 'openEntity');
    act(() => root.render(createElement(EditorBridgeProvider, { bridge, children: createElement('span') })));
    const open = openEntityHandler('endpoint', 'get-users', editorBridge);
    expect(open).toBeTypeOf('function');
    open!();
    expect(spy).toHaveBeenCalledWith('endpoint', 'get-users');
    expect(calls).toEqual([['entity', 'endpoint', 'get-users']]);
    spy.mockRestore();
  });
});
