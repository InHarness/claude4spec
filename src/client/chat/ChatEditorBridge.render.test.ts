// @vitest-environment happy-dom
/**
 * 2.1.28 — M53 `rehyxchp`: the chat message tree is wrapped in an
 * `EditorBridgeProvider` with the chat-aware bridge, and a chip in chat calls
 * `editorBridge.openEntity(...)` / `editorBridge.openSection(...)` itself. The
 * singleton reaches the chat-aware bridge (the nearest provider), which
 * navigates the main pane under the overlay and leaves the overlay open — even
 * while the page editor's own provider is mounted beside it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const nav = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => (opts: unknown) => {
    nav.calls.push(opts);
    return Promise.resolve();
  },
}));
vi.mock('../hooks/useConfig.js', () => ({ useBaseRootId: () => 'pages' }));
const endpointModule = { type: 'endpoint', pathPrefix: '/endpoints', routes: {}, detailPanel: () => null };
vi.mock('../core/plugin-host/host.js', () => ({
  clientPluginHost: { getEntity: (t: string) => (t === 'endpoint' ? endpointModule : null) },
  categoriseBrokenChip: () => 'unknown-type',
}));
vi.mock('../entities/registry.js', () => ({
  getEntityDef: (t: string) => (t === 'endpoint' ? { type: 'endpoint' } : null),
}));
// The host resolver, reduced to the click it forwards: the type's chip calls `onOpen`.
vi.mock('../entities/ChipResolver.js', () => ({
  ChipResolver: ({ slug, onOpen }: { slug: string; onOpen?: () => void }) =>
    createElement('button', { 'data-chip': slug, onClick: () => onOpen?.() }, slug),
}));
vi.mock('../tiptap/extensions/views/BrokenChip.js', () => ({
  InlineBrokenChip: ({ slug }: { slug: string }) => createElement('span', null, `[broken: ${slug}]`),
}));
vi.mock('../xml-markup/renders.js', () => ({ getTagRender: () => undefined }));

import { ChatEditorBridgeProvider, createChatAwareBridge } from './ChatEditorBridge.js';
import { XmlChipDispatcher } from './XmlChipDispatcher.js';
import { EditorBridgeProvider, type EditorBridge } from '../tiptap/EditorContext.js';
import { editorBridge } from '../runtime/editor-bridge.js';
import type { SanitizedChip } from './xml-chip-preprocess.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let qc: QueryClient;

beforeEach(() => {
  nav.calls = [];
  qc = new QueryClient();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(node: ReactNode) {
  act(() => root.render(createElement(QueryClientProvider, { client: qc }, node)));
}

const chip = (slug: string): SanitizedChip =>
  ({ kind: 'inline_mention', attrs: { type: 'endpoint', slug } }) as unknown as SanitizedChip;

describe('chat pipeline — chat-aware EditorBridge behind the editorBridge singleton', () => {
  it('[section:rehyxchp] a chip in the chat message tree navigates through the chat-aware bridge of the surrounding provider, not the page editor\'s bridge mounted beside it', () => {
    const editorCalls: string[] = [];
    const editorSide: EditorBridge = {
      openEntity: (_t, slug) => editorCalls.push(slug),
      openSection: (_p, anchor) => editorCalls.push(anchor),
    };
    render(
      createElement(
        'div',
        null,
        createElement(EditorBridgeProvider, { bridge: editorSide, children: createElement('p', null, 'page') }),
        createElement(ChatEditorBridgeProvider, null, createElement(XmlChipDispatcher, { chip: chip('get-users') })),
      ),
    );
    const el = document.querySelector<HTMLButtonElement>('[data-chip="get-users"]');
    expect(el).not.toBeNull();
    act(() => el!.click());
    expect(editorCalls).toEqual([]);
    expect(nav.calls).toEqual([{ to: '/endpoints/$slug', params: { slug: 'get-users' } }]);
  });

  it('[section:rehyxchp] the chat-aware bridge only navigates (the overlay is left open): openEntity to the type\'s detail route, openSection to the page of the section\'s own root', () => {
    const navigate = vi.fn();
    const cache = new QueryClient();
    cache.setQueryData(['section', 'abc12345'], { anchor: 'abc12345', rootId: 'docs', pagePath: 'guide/intro.md' });
    const bridge = createChatAwareBridge(navigate as never, cache, 'pages');
    bridge.openEntity('endpoint', 'get-users');
    bridge.openSection('guide/intro.md', 'abc12345');
    // No index entry for this anchor → the project's base page root.
    bridge.openSection('other.md', 'zzz99999');
    // A deactivated / unknown type has no mounted route: nothing happens.
    bridge.openEntity('gone', 'x');
    expect(navigate.mock.calls.map((c) => c[0])).toEqual([
      { to: '/endpoints/$slug', params: { slug: 'get-users' } },
      { to: '/space/$rootId/$', params: { rootId: 'docs', _splat: 'guide/intro.md' }, hash: 'anchor-abc12345' },
      { to: '/space/$rootId/$', params: { rootId: 'pages', _splat: 'other.md' }, hash: 'anchor-zzz99999' },
    ]);
  });

  it('[section:rehyxchp] inside the chat provider, editorBridge.openSection reaches the chat-aware bridge', () => {
    function SectionChip() {
      return createElement('button', { 'data-chip': 'sec', onClick: () => editorBridge.openSection('a.md', 'abc12345') }, 's');
    }
    render(createElement(ChatEditorBridgeProvider, null, createElement(SectionChip)));
    act(() => document.querySelector<HTMLButtonElement>('[data-chip="sec"]')!.click());
    expect(nav.calls).toEqual([{ to: '/space/$rootId/$', params: { rootId: 'pages', _splat: 'a.md' }, hash: 'anchor-abc12345' }]);
  });
});
