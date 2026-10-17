// @vitest-environment happy-dom
/**
 * 2.1.28 — M20 `m20l11sc` / `nvc5wy2p`: `@c4s/plugin-runtime` exports an
 * `editorBridge` singleton that delegates to the bridge of the NEAREST
 * `EditorBridgeProvider`. A chip calls the singleton, never a hook, and behaves
 * differently in the editor and in chat without knowing which one it is in.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement, Fragment, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { EditorBridgeProvider, type EditorBridge } from '../tiptap/EditorContext.js';
import { editorBridge, editorBridgeRegistry } from './editor-bridge.js';
import * as pluginRuntime from './plugin-runtime.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Call = [string, string, string];

function recorder(name: string, calls: Call[]): EditorBridge {
  return {
    openEntity: (type, slug) => calls.push([name, type, slug]),
    openSection: (pagePath, anchor) => calls.push([name, pagePath, anchor]),
  };
}

/** A chip the way the contract writes it: it calls the singleton, nothing else. */
function Chip({ id, section }: { id: string; section?: boolean }) {
  return createElement(
    'button',
    {
      'data-chip': id,
      onClick: () =>
        section ? editorBridge.openSection('guide/intro.md', 'abc12345') : editorBridge.openEntity('endpoint', id),
    },
    id,
  );
}

function provider(bridge: EditorBridge, ...children: ReactNode[]) {
  return createElement(EditorBridgeProvider, { bridge, children: createElement(Fragment, null, ...children) });
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
});

function click(id: string) {
  const el = document.querySelector<HTMLButtonElement>(`[data-chip="${id}"]`);
  expect(el, id).not.toBeNull();
  act(() => el!.click());
}

describe('editorBridge singleton — delegates to the nearest EditorBridgeProvider', () => {
  it('[section:m20l11sc] the singleton exported from @c4s/plugin-runtime reaches the bridge of the nearest provider: the same chip in the editor pipeline and in the chat pipeline calls each one\'s own bridge', () => {
    expect(pluginRuntime.editorBridge).toBe(editorBridge);
    const calls: Call[] = [];
    act(() =>
      root.render(
        createElement(
          'div',
          null,
          provider(recorder('editor', calls), createElement(Chip, { id: 'in-editor' })),
          provider(recorder('chat', calls), createElement(Chip, { id: 'in-chat' })),
        ),
      ),
    );
    click('in-editor');
    click('in-chat');
    expect(calls).toEqual([
      ['editor', 'endpoint', 'in-editor'],
      ['chat', 'endpoint', 'in-chat'],
    ]);
  });

  it('[section:m20l11sc] with nested providers the innermost wins for a chip inside it, the outer one for a chip outside the inner subtree', () => {
    const calls: Call[] = [];
    act(() =>
      root.render(
        provider(
          recorder('route', calls),
          createElement(Chip, { id: 'outer' }),
          provider(recorder('doc-editor', calls), createElement(Chip, { id: 'inner' })),
        ),
      ),
    );
    click('inner');
    click('outer');
    expect(calls).toEqual([
      ['doc-editor', 'endpoint', 'inner'],
      ['route', 'endpoint', 'outer'],
    ]);
  });

  it('[section:m20l11sc] a chip rendered through a portal counts as inside the provider that rendered it (React tree, not DOM tree)', () => {
    const calls: Call[] = [];
    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);
    act(() =>
      root.render(
        createElement(
          'div',
          null,
          provider(recorder('editor', calls), createPortal(createElement(Chip, { id: 'portal' }), elsewhere)),
          provider(recorder('chat', calls), createElement('span', null, 'chat')),
        ),
      ),
    );
    click('portal');
    expect(calls).toEqual([['editor', 'endpoint', 'portal']]);
    elsewhere.remove();
  });

  it('[section:nvc5wy2p] a chip opens a section through editorBridge.openSection, and the provider\'s bridge — not the chip — decides what navigation means', () => {
    const calls: Call[] = [];
    act(() => root.render(provider(recorder('editor', calls), createElement(Chip, { id: 'sec', section: true }))));
    click('sec');
    expect(calls).toEqual([['editor', 'guide/intro.md', 'abc12345']]);
  });

  it('[section:nvc5wy2p] outside any interaction the singleton falls back to the most recently mounted provider; with none mounted it does nothing', () => {
    const calls: Call[] = [];
    act(() =>
      root.render(
        createElement('div', null, provider(recorder('first', calls), null), provider(recorder('second', calls), null)),
      ),
    );
    editorBridge.openEntity('endpoint', 'programmatic');
    expect(calls).toEqual([['second', 'endpoint', 'programmatic']]);
    act(() => root.render(createElement('div')));
    expect(editorBridgeRegistry.current()).toBeNull();
    expect(() => editorBridge.openEntity('endpoint', 'nobody')).not.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('[section:nvc5wy2p] a re-rendered provider with a new bridge value keeps its place and its chips reach the new bridge', () => {
    const calls: Call[] = [];
    act(() => root.render(provider(recorder('v1', calls), createElement(Chip, { id: 'c' }))));
    act(() => root.render(provider(recorder('v2', calls), createElement(Chip, { id: 'c' }))));
    click('c');
    expect(calls).toEqual([['v2', 'endpoint', 'c']]);
  });
});
