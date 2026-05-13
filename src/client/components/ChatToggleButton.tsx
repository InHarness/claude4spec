import { Sparkles } from 'lucide-react';
import { useChatStore } from '../state/chat.js';

export function ChatToggleButton() {
  const chatOpen = useChatStore((s) => s.chatOpen);
  const toggleChat = useChatStore((s) => s.toggleChat);

  return (
    <button
      type="button"
      onClick={toggleChat}
      aria-pressed={chatOpen}
      title={chatOpen ? 'Hide chat (⌘K)' : 'Show chat (⌘K)'}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition"
      style={{
        background: chatOpen ? 'var(--c-card)' : 'var(--c-panel)',
        color: chatOpen ? 'var(--c-accent)' : 'var(--c-ink)',
        border: `1px solid ${chatOpen ? 'var(--c-accent)' : 'var(--c-hair-strong)'}`,
        cursor: 'pointer',
      }}
    >
      <Sparkles size={12} />
      Chat
      <kbd>⌘K</kbd>
    </button>
  );
}
