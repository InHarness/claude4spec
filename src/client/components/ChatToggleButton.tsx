import { Sparkles } from 'lucide-react';
import { useChatStore } from '../state/chat.js';
import { SegmentButton } from './ButtonGroup.js';

export function ChatToggleButton() {
  const chatOpen = useChatStore((s) => s.chatOpen);
  const toggleChat = useChatStore((s) => s.toggleChat);

  return (
    <SegmentButton
      icon={<Sparkles size={12} />}
      label="Chat"
      active={chatOpen}
      onClick={toggleChat}
      title={chatOpen ? 'Hide chat (⌘K)' : 'Show chat (⌘K)'}
    />
  );
}
