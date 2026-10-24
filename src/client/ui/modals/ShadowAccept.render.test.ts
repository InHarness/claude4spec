// @vitest-environment happy-dom
/**
 * 2.1.47 (M17 L5 m17ui001 „Okna”) — the `shadow-accept` window: the release
 * name and description, the description suggested from the preview's commit
 * messages, cut to 500 code points, with a visible code-point counter against
 * that limit; „Accept & release” answers the window with the fields.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ShadowAccept, suggestShadowDescription } from './ShadowAccept.js';
import type { ModalRequest } from '../events.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TIP = 'bbbbbbb2222222222222222222222222222222';
let host: HTMLDivElement;
let root: Root;
let closed: unknown[];

async function render(commits: Array<{ sha: string; subject: string; body: string }>) {
  const request = {
    kind: 'shadow-accept',
    props: { shadowId: 'run-1/spec', tipSha: TIP, headSha: 'c'.repeat(40), commits },
    onSubmit: () => {},
    onCancel: () => {},
  } as ModalRequest<'shadow-accept'>;
  await act(async () => {
    root.render(createElement(ShadowAccept, { request, onClose: (r: unknown) => closed.push(r) }));
  });
}

const q = <T extends HTMLElement = HTMLElement>(sel: string) => host.querySelector<T>(sel);

/** Sets a controlled field the way React listens for it (native setter + `input` event). */
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(el: HTMLElement | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  closed = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('shadow-accept window (M17 m17ui001, 2.1.47)', () => {
  it('[section:m17ui001] the description is suggested from the commit messages, with a code-point counter against 500; "Accept & release" answers with the name and description', async () => {
    await render([
      { sha: TIP, subject: 'Add the orders endpoint', body: 'Covers create and list.' },
      { sha: 'e'.repeat(40), subject: 'Rename the order DTO', body: '' },
    ]);
    const description = q<HTMLTextAreaElement>('[data-shadow-accept-description]')!;
    expect(description.value).toBe('Add the orders endpoint\n\nCovers create and list.\n\nRename the order DTO');
    expect(q('[data-shadow-accept-counter]')!.textContent).toBe(`${[...description.value].length} / 500`);
    expect(host.textContent).toContain('run-1/spec');
    expect(host.textContent).toContain('bbbbbbb');

    // No name yet → „Accept & release” is inactive.
    const submit = q<HTMLButtonElement>('[data-shadow-accept-submit]')!;
    expect(submit.textContent).toBe('Accept & release');
    expect(submit.disabled).toBe(true);

    await type(q<HTMLInputElement>('[data-shadow-accept-name]')!, '  v2  ');
    expect(submit.disabled).toBe(false);
    await click(submit);
    expect(closed).toEqual([
      { name: 'v2', description: 'Add the orders endpoint\n\nCovers create and list.\n\nRename the order DTO' },
    ]);
  });

  it('[section:m17ui001] the suggestion is cut to 500 code points (an astral character counts once); over the limit the counter turns red and the window refuses to answer', async () => {
    const long = '😀'.repeat(300) + 'x'.repeat(300);
    expect([...suggestShadowDescription([{ sha: TIP, subject: long, body: '' }])]).toHaveLength(500);
    await render([{ sha: TIP, subject: long, body: '' }]);
    expect(q('[data-shadow-accept-counter]')!.textContent).toBe('500 / 500');

    await type(q<HTMLInputElement>('[data-shadow-accept-name]')!, 'v2');
    await type(q<HTMLTextAreaElement>('[data-shadow-accept-description]')!, 'y'.repeat(501));
    expect(q('[data-shadow-accept-counter]')!.textContent).toBe('501 / 500');
    expect(q<HTMLButtonElement>('[data-shadow-accept-submit]')!.disabled).toBe(true);
  });

  it('[section:m17ui001] Cancel closes the window without an answer', async () => {
    await render([]);
    expect(q<HTMLTextAreaElement>('[data-shadow-accept-description]')!.value).toBe('');
    await click(q('[data-shadow-accept-cancel]'));
    expect(closed).toEqual([null]);
  });
});
