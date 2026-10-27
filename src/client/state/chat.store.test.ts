// @vitest-environment happy-dom
/**
 * M53 (Agent Chat Shell, `m7finw6e` → Stan) — the `chat` store: its persisted
 * fields live under `c4s:m05:chat-store::<projectId>`, a key whose `m05` is the
 * literal of existing keys, suffixed with the id of the project injected into
 * the document (never the port). Adding an annotation opens a closed chat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Load the store the way a fresh page load of project `id` does. */
async function freshPage(id: string) {
  window.__C4S_PROJECT__ = { id };
  vi.resetModules();
  return import('./chat.js');
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  delete window.__C4S_PROJECT__;
  window.localStorage.clear();
});

describe('chat store', () => {
  it('[ac:ac-otwarcie-innego-projektu-innego-cwd-na] opening another project on the same host:port does not restore the previous project\'s chatThreadId — the key is suffixed with the injected project id', async () => {
    const a = await freshPage('proj-a');
    a.useChatStore.getState().setChatThreadId('thread-of-a');
    expect(window.localStorage.getItem('c4s:m05:chat-store::proj-a')).toContain('thread-of-a');

    // Same origin, another project: a new conversation.
    const b = await freshPage('proj-b');
    expect(b.useChatStore.getState().chatThreadId).toBeNull();
    expect(window.localStorage.getItem('c4s:m05:chat-store::proj-b') ?? '').not.toContain('thread-of-a');

    // Back on project A its own thread is still there.
    const again = await freshPage('proj-a');
    expect(again.useChatStore.getState().chatThreadId).toBe('thread-of-a');
  });

  it('[section:m7finw6e] the persisted fields are chatOpen, chatWidth, chatThreadId, model and thinking — never the annotation buffer', async () => {
    const s = await freshPage('proj-c');
    s.useChatStore.getState().addAnnotation({ id: 'a1', text: 'x', comment: '', page: 'p.md' });
    s.useChatStore.getState().setModel('opus-5.5', true);
    const saved = JSON.parse(window.localStorage.getItem('c4s:m05:chat-store::proj-c')!) as { state: Record<string, unknown> };
    expect(Object.keys(saved.state).sort()).toEqual(['chatOpen', 'chatThreadId', 'chatWidth', 'model', 'thinking']);
  });

  it('[ac:ac-utworzenie-adnotacji-przy-zamknietym] creating an annotation while the chat is closed opens the chat panel', async () => {
    const { useChatStore } = await freshPage('proj-d');
    useChatStore.getState().setChatOpen(false);
    useChatStore.getState().addAnnotation({ id: 'a1', text: 'selected', comment: '', page: 'p.md', range: { from: 1, to: 9 } });
    expect(useChatStore.getState().chatOpen).toBe(true);
    expect(useChatStore.getState().annotations).toHaveLength(1);
  });
});
