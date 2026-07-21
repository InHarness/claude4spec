import { useChatStore } from '../state/chat.js';
import { requestChatPrefill } from './chatPrefill.js';

export interface StartSeededThreadOptions {
  /** When true, the seed prompt is auto-submitted to the agent immediately. */
  autoSubmit?: boolean;
}

/**
 * M05 chat orchestration (brief 0.1.45 §3). Opens the chat overlay on a fresh
 * thread and seeds it with `prompt`. Pure client orchestration over the
 * existing `post-api-chat` endpoint — no new endpoint, no new `context_type`:
 *
 * 1. `setChatThreadId(null)` — start a new `context_type='chat'` thread; the
 *    server creates it server-side on the first message and returns its id in
 *    the SSE `connected` event.
 * 2. `setChatOpen(true)` — open `<ChatOverlay />`.
 * 3. `requestChatPrefill({ prompt, autoSend })` — ChatOverlay fills the editor
 *    and, when `autoSubmit` is set and the thread is empty, `sendMessage`s the
 *    seed as a normal user message (persisted in `chat_message`).
 *
 * Shares the prefill path (`requestChatPrefill` → `CHAT_PREFILL_EVENT`) with
 * M10's plan footer, but not the thread-creation logic: M10's Run plan /
 * Analyse plan go through `post-api-plans-slug-create-thread`, which attaches
 * the plan server-side (`plan_path`) and drafts the prompt with
 * `autoSend: false`; this helper posts to bare `post-api-chat` with no
 * `plan_path` and usually auto-sends.
 */
export function startSeededThread(prompt: string, opts: StartSeededThreadOptions = {}): void {
  const store = useChatStore.getState();
  store.setChatThreadId(null);
  store.setChatOpen(true);
  requestChatPrefill({ prompt, autoSend: opts.autoSubmit ?? false });
}
