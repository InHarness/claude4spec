// @vitest-environment happy-dom
/**
 * M53 (Agent Chat Shell) — the live agent-question card (`m05usrin`) for a
 * request that carries no questions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { UserInputRequest } from '@inharness-ai/agent-adapters';
import { UserInputRequestCard } from './UserInputRequestCard.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
});

const empty: UserInputRequest = { requestId: 'q-empty', source: 'mcp-elicitation', origin: 'some-mcp', questions: [] };
const buttonLabels = () => [...host.querySelectorAll('button')].map((b) => b.textContent?.trim());

describe('agent question with no questions', () => {
  it('[ac:ac-userinputrequest-questions-bedace-pus] an empty `UserInputRequest.questions` renders a card with no question form, only Decline and Cancel, instead of breaking the render', () => {
    expect(() => act(() => root.render(createElement(UserInputRequestCard, { request: empty, onSubmit: vi.fn() })))).not.toThrow();
    expect(host.textContent).toContain('some-mcp');
    expect(host.querySelector('textarea')).toBeNull();
    expect(buttonLabels()).toEqual(['Decline', 'Cancel']);
  });

  it('[ac:ac-dismiss-karty-user-input-request-pozb-2] dismissing a `user_input_request` card without questions sends the answer `{action: \'cancel\'}`', () => {
    const onSubmit = vi.fn();
    act(() => root.render(createElement(UserInputRequestCard, { request: empty, onSubmit })));
    const cancel = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancel')!;
    act(() => cancel.click());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('q-empty', { action: 'cancel' });
  });
});
