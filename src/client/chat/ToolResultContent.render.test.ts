// @vitest-environment happy-dom
/**
 * M53 (Agent Chat Shell, 2.1.87) — images from a tool's result in the expanded
 * tool card: raster types only, in result order, scaled to the card, with the
 * `Image could not be displayed` fallback; `tool-json-view` stays raw; a result
 * degraded in the replay buffer shows the truncation marker until history
 * brings its content back. Blocks go through `batchToolBlocks` exactly as
 * `<ChatOverlay />` hands them to `<BlockRenderer />`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { batchToolBlocks, type UIContentBlock } from '@inharness-ai/agent-chat';

vi.mock('../entities/registry.js', () => ({ getEntityDef: () => null }));
vi.mock('../entities/ChipResolver.js', () => ({
  ChipResolver: ({ slug }: { slug: string }) => createElement('span', { 'data-chip': slug }, slug),
}));

import { BlockRenderer } from './BlockRenderer.js';
import { getRenderer } from './toolRenderers.js';
import { rowsToChatMessages } from './useChat.js';
import { ToolResultReplayContext, type ToolResultReplayState } from './ToolResultContent.js';
import { ToolJsonView } from '../ui/modals/ToolJsonView.js';
import type { ModalRequest } from '../ui/events.js';
import type { ChatMessage } from '../../shared/entities.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let modals: ModalRequest[];
const onModal = (e: Event) => modals.push((e as CustomEvent<ModalRequest>).detail);

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  modals = [];
  window.addEventListener('c4s:modal-open', onModal);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.removeEventListener('c4s:modal-open', onModal);
});

/** A fresh root — the card's expanded state must not carry over. */
function remount() {
  act(() => root.unmount());
  root = createRoot(host);
}

function render(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  act(() => root.render(createElement(QueryClientProvider, { client: qc }, node)));
}

function renderMessage(blocks: UIContentBlock[], replay?: ToolResultReplayState) {
  const shown = batchToolBlocks(blocks);
  const list = createElement(
    'div',
    null,
    shown.map((block, i) => createElement(BlockRenderer, { key: i, block, siblings: shown, side: 'assistant', model: 'opus-5.5' })),
  );
  render(replay ? createElement(ToolResultReplayContext.Provider, { value: replay }, list) : list);
}

// A 1×1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const text = (t: string) => ({ type: 'text', text: t });
const image = (data: string, mediaType = 'image/png') => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
/** The adapter's `summary`: `JSON.stringify` of the SDK content array. */
const content = (...blocks: unknown[]) => JSON.stringify(blocks);

const TOOL = 'mcp__playwright__browser_take_screenshot';
const use = (id: string, toolName = TOOL): UIContentBlock => ({ type: 'toolUse', toolUseId: id, toolName, input: {}, collapsed: true });
const result = (id: string, c: string): UIContentBlock => ({ type: 'toolResult', toolUseId: id, content: c, isError: false, collapsed: true });

const expand = () => {
  const toggle = [...host.querySelectorAll('button')].find((b) => b.hasAttribute('aria-expanded'))!;
  act(() => toggle.click());
};
const imgs = () => [...host.querySelectorAll('img')];
const fallbackLink = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'open raw JSON');

describe('images in the tool card', () => {
  it('[ac:ac-rozwinieta-karta-narzedzia-ktorego-wy] the expanded card of a tool whose result holds a base64 PNG image block shows that image', () => {
    renderMessage([use('s1'), result('s1', content(image(PNG)))]);
    // Collapsed: a bar, no thumbnail.
    expect(imgs()).toHaveLength(0);
    expand();
    expect(imgs()).toHaveLength(1);
    expect(imgs()[0]!.getAttribute('src')).toBe(`data:image/png;base64,${PNG}`);
  });

  it('[ac:ac-bloki-tekstowe-i-obrazowe-jednego-wyn] text and image blocks of one result show in the card in the result order', () => {
    renderMessage([use('s1'), result('s1', content(text('before'), image(PNG), text('after'), image(PNG, 'image/webp')))]);
    expand();
    const seq = [...host.querySelectorAll('[data-tool-result="blocks"] > *')].map((el) =>
      el.tagName === 'IMG' ? `img:${el.getAttribute('src')!.split(';')[0]}` : el.textContent,
    );
    expect(seq).toEqual(['before', 'img:data:image/png', 'after', 'img:data:image/webp']);
  });

  it('[ac:ac-karta-narzedzia-bez-wpisu-w-rejestrze] a card with no renderer-registry entry shows the image from the result when expanded', () => {
    const name = 'mcp__other-tools__do_thing';
    expect(getRenderer(name)).toBeNull();
    renderMessage([use('s1', name), result('s1', content(image(PNG)))]);
    expand();
    expect(host.textContent).toContain('do_thing');
    expect(imgs()).toHaveLength(1);
  });

  it('[ac:ac-obraz-z-wyniku-narzedzia-szerszy-od-k] an image wider than the card is scaled down to its width, keeping the aspect ratio', () => {
    renderMessage([use('s1'), result('s1', content(image(PNG)))]);
    expand();
    const img = imgs()[0]!;
    expect(img.style.maxWidth).toBe('100%');
    expect(img.style.height).toBe('auto');
    expect(img.hasAttribute('width')).toBe(false);
  });

  it('[ac:ac-okno-tool-json-view-dla-wyniku-z-obra] `tool-json-view` for a result with an image shows the raw base64 data, no preview', () => {
    renderMessage([use('s1'), result('s1', content(text('shot taken'), image(PNG)))]);
    act(() => (host.querySelector('button[aria-label="Show raw JSON"]') as HTMLElement).click());
    expect(modals).toHaveLength(1);
    expect(modals[0]!.kind).toBe('tool-json-view');
    act(() => root.render(createElement(ToolJsonView, { request: modals[0] as ModalRequest<'tool-json-view'>, onClose: () => {} })));
    const dialog = document.querySelector('[role="dialog"]')!;
    // The image block after the text block survives, base64 and all.
    expect(dialog.textContent).toContain(PNG);
    expect(dialog.textContent).toContain('"media_type": "image/png"');
    expect(dialog.querySelector('img')).toBeNull();
  });

  it('[ac:ac-obraz-z-wyniku-narzedzia-wczytanego-z] an image from a non-degraded result loaded from thread history renders the same as one from the live stream', () => {
    const c = content(text('a'), image(PNG), image('x', 'image/svg+xml'));
    renderMessage([use('s1'), result('s1', c)]);
    expand();
    const live = host.querySelector('[data-tool-result="blocks"]')!.outerHTML;

    const row = (over: Partial<ChatMessage>): ChatMessage => ({
      id: 1, threadId: 't1', role: 'assistant', content: '', toolName: null, toolId: null, subagentTaskId: null,
      planMode: false, status: 'complete', usage: null, contextSize: null, createdAt: '2026-11-13T10:00:00.000Z', ...over,
    });
    const [msg] = rowsToChatMessages([
      row({ id: 1, role: 'tool_use', toolName: TOOL, toolId: 's1', content: JSON.stringify({ input: {} }) }),
      row({ id: 2, role: 'tool_result', toolId: 's1', content: JSON.stringify({ summary: c, isError: false }) }),
    ], []);
    remount();
    renderMessage(msg!.blocks);
    expand();
    expect(host.querySelector('[data-tool-result="blocks"]')!.outerHTML).toBe(live);
  });
});

describe('images the card does not display', () => {
  it('[ac:ac-blok-obrazu-w-wyniku-narzedzia-o-typi-2] an image block of a non-raster type, `image/svg+xml` included, shows `Image could not be displayed` with an "open raw JSON" link instead', () => {
    const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    renderMessage([use('s1'), result('s1', content(image(svg, 'image/svg+xml'), image(PNG, 'image/bmp')))]);
    expand();
    expect(imgs()).toHaveLength(0);
    const fallbacks = host.querySelectorAll('[data-tool-result="image-fallback"]');
    expect(fallbacks).toHaveLength(2);
    expect(fallbacks[0]!.textContent).toContain('Image could not be displayed');
    // The link opens the raw JSON window for this result.
    act(() => fallbackLink()!.click());
    expect(modals.map((m) => m.kind)).toEqual(['tool-json-view']);
    expect(JSON.stringify(modals[0]!.props)).toContain('image/svg+xml');
  });

  it('[ac:ac-blok-obrazu-w-wyniku-narzedzia-z-dany] an image block whose base64 data cannot be decoded shows `Image could not be displayed` with an "open raw JSON" link', () => {
    renderMessage([use('s1'), result('s1', content(image('not base64 at all!')))]);
    expand();
    expect(imgs()).toHaveLength(0);
    expect(host.textContent).toContain('Image could not be displayed');
    expect(fallbackLink()).toBeTruthy();

    // Data `atob` accepts but the browser cannot decode: the <img> error.
    remount();
    renderMessage([use('s2'), result('s2', content(image('AAAA')))]);
    expand();
    act(() => {
      imgs()[0]!.dispatchEvent(new Event('error'));
    });
    expect(imgs()).toHaveLength(0);
    expect(host.textContent).toContain('Image could not be displayed');
    expect(fallbackLink()).toBeTruthy();
  });
});

describe('replay buffer', () => {
  it('[ac:ac-wynik-narzedzia-z-obrazem-zdegradowan] a result degraded in the replay buffer shows the truncation marker instead of the image', () => {
    renderMessage([use('s1'), result('s1', '')], { degraded: new Set(['s1']), overrides: new Map() });
    expand();
    expect(imgs()).toHaveLength(0);
    expect(host.querySelector('[data-tool-result="truncated"]')).not.toBeNull();
  });

  it('[ac:ac-po-zakonczeniu-tury-karta-wyniku-zdeg] after the turn the card of a degraded result shows the image from thread history', () => {
    renderMessage([use('s1'), result('s1', '')], {
      degraded: new Set(['s1']),
      overrides: new Map([['s1', content(image(PNG))]]),
    });
    expand();
    expect(host.querySelector('[data-tool-result="truncated"]')).toBeNull();
    expect(imgs()[0]!.getAttribute('src')).toBe(`data:image/png;base64,${PNG}`);
  });
});
