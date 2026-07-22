import { Sparkles } from 'lucide-react';
import { useChatStore } from '../state/chat.js';

/**
 * In-header shortcut to the chat overlay. The `⌘K` binding it advertises is
 * global and already lives in `App.tsx` — this is only the visible affordance,
 * the horizontal counterpart to `<ChatEdgeAffordance />` (the vertical rail
 * shown when chat is closed).
 */
export function ChatToggleButton() {
  const toggleChat = useChatStore((s) => s.toggleChat);
  return (
    <button
      onClick={toggleChat}
      title="Toggle chat (⌘K)"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] btn-ghost"
      style={{ color: 'var(--c-muted)', border: '1px solid var(--c-hair-strong)' }}
    >
      <Sparkles size={12} style={{ color: 'var(--c-accent)' }} />
      Chat
      <span className="font-mono text-[10px]" style={{ color: 'var(--c-subtle)' }}>
        ⌘K
      </span>
    </button>
  );
}
