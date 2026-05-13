export const CHAT_PREFILL_EVENT = 'c4s:chat-prefill';

export interface ChatPrefillDetail {
  prompt: string;
  /**
   * Gdy `true`, ChatOverlay nie tylko wstrzyknie prompt do edytora, ale od
   * razu wyśle go do agenta — pod warunkiem że bieżący thread jest pusty
   * (idempotencja na `messages.length === 0`, żeby reload strony nie
   * dublował wiadomości).
   */
  autoSend?: boolean;
}

export function requestChatPrefill(detail: ChatPrefillDetail): void {
  window.dispatchEvent(
    new CustomEvent<ChatPrefillDetail>(CHAT_PREFILL_EVENT, { detail })
  );
}
