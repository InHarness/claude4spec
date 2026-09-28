// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NodeViewProps } from '@tiptap/react';
import { RawJsxView } from './RawJsxView.js';

/**
 * 2.0.0 → next: the raw JSX block (M20) must not collapse to `height: 0px` when
 * its NodeView mounts before layout — `rows` stays in effect until a non-zero
 * measurement arrives, then the textarea auto-sizes; long lines scroll.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = '<FlagList>\n  <Flag name="--project" />\n  <Flag name="--workspace" />\n</FlagList>';

let host: HTMLDivElement;
let root: Root;
let scrollHeight: number;
let frames: Map<number, FrameRequestCallback>;
let observers: Array<{ disconnect: ReturnType<typeof vi.fn> }>;

function props(typeName: string, raw: string): NodeViewProps {
  return {
    node: { type: { name: typeName }, attrs: { raw } },
    updateAttributes: vi.fn(),
  } as unknown as NodeViewProps;
}

function render(typeName: string, raw: string) {
  act(() => root.render(createElement(RawJsxView, props(typeName, raw))));
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  scrollHeight = 0;
  vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scrollHeight);
  frames = new Map();
  let nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  observers = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn();
      constructor() {
        observers.push(this);
      }
      observe() {}
    },
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RawJsxView — block autosize', () => {
  it('keeps rows in effect while unmeasured, then sizes to scrollHeight after layout', () => {
    render('raw_jsx_block', RAW);
    const ta = host.querySelector('textarea[aria-label="Raw JSX block"]') as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    expect(ta.style.height).not.toBe('0px');
    expect(ta.style.height).toBe('');
    expect(ta.getAttribute('rows')).toBe(String(RAW.split('\n').length));

    scrollHeight = 90;
    act(() => {
      for (const cb of frames.values()) cb(0);
    });
    expect(ta.style.height).toBe('90px');
  });

  it('cancels the pending frame and disconnects the observer on unmount', () => {
    render('raw_jsx_block', RAW);
    expect(observers).toHaveLength(1);
    const [frameId] = [...frames.keys()];
    act(() => root.unmount());
    expect(cancelAnimationFrame).toHaveBeenCalledWith(frameId);
    expect(observers[0]!.disconnect).toHaveBeenCalled();
    root = createRoot(host); // afterEach unmounts again
  });

  it('scrolls long lines horizontally instead of clipping them', () => {
    render('raw_jsx_block', RAW);
    const ta = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.style.overflowX).toBe('auto');
    expect(ta.style.overflowY).toBe('hidden');
  });

  it('leaves the inline variant clipped as before', () => {
    render('raw_jsx_inline', '<CmdBox cmd="c4s ask" />');
    const input = host.querySelector('input[aria-label="Raw JSX"]') as HTMLInputElement;
    expect(input.style.overflow).toBe('hidden');
    expect(observers).toHaveLength(0);
  });
});
