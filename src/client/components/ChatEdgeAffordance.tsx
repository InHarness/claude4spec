import { Sparkles } from 'lucide-react';
import { useChatStore } from '../state/chat.js';

export function ChatEdgeAffordance() {
  const chatOpen = useChatStore((s) => s.chatOpen);
  const toggleChat = useChatStore((s) => s.toggleChat);
  if (chatOpen) return null;

  return (
    <button
      onClick={toggleChat}
      title="Open chat"
      className="flex flex-col items-center gap-2 px-1.5 py-3 hover:bg-[var(--c-hair)]/40"
      style={{
        width: 32,
        background: 'var(--c-bg)',
        borderLeft: '1px solid var(--c-hair)',
        color: 'var(--c-muted)',
      }}
    >
      <span
        className="rounded-md inline-flex items-center justify-center"
        style={{ width: 22, height: 22, color: 'var(--c-accent)' }}
      >
        <Sparkles size={14} />
      </span>
      <span
        className="text-[10.5px] font-mono uppercase tracking-wider"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        Chat
      </span>
    </button>
  );
}
