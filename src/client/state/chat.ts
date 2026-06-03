import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Annotation } from '../../shared/entities.js';
import { projectKey } from './persisted.js';

// One-shot migration: stary klucz `c4s-chat` → `c4s:m05:chat-store` (zgodnie z L5-ui clpst5l1).
if (typeof window !== 'undefined') {
  try {
    const NEW_KEY = 'c4s:m05:chat-store';
    const OLD_KEY = 'c4s-chat';
    if (window.localStorage.getItem(NEW_KEY) === null) {
      const legacy = window.localStorage.getItem(OLD_KEY);
      if (legacy !== null) {
        window.localStorage.setItem(NEW_KEY, legacy);
        window.localStorage.removeItem(OLD_KEY);
      }
    }
  } catch {
    /* localStorage unavailable */
  }
}

export type ChatModel = 'sonnet-4.6' | 'opus-4.8' | 'haiku-4.5';
export type ChatThinking = 'off' | 'low' | 'medium' | 'high' | 'max';

// Map UI thinking level → adapter architectureConfig.
// Opus 4.8 supports 'adaptive' thinking only, plus a reasoning-effort knob
// (claude_effort: low/medium/high/max) — the UI level drives that effort.
// Other models use a fixed thinking budget; 'max' is opus-only so it clamps to 'high'.
export function thinkingToConfig(
  level: ChatThinking,
  model: ChatModel,
): Record<string, unknown> | undefined {
  if (level === 'off') return undefined;
  if (model === 'opus-4.8') return { claude_thinking: 'adaptive', claude_effort: level };
  const budget = { low: 2048, medium: 8192, high: 24000, max: 24000 }[level];
  return { claude_thinking: 'enabled', claude_thinking_budget: budget };
}

interface ChatState {
  chatOpen: boolean;
  chatWidth: number;
  chatThreadId: string | null;
  annotations: Annotation[];
  model: ChatModel;
  thinking: ChatThinking;
  setChatOpen(open: boolean): void;
  toggleChat(): void;
  setChatWidth(px: number): void;
  setChatThreadId(id: string | null): void;
  setModel(m: ChatModel): void;
  setThinking(t: ChatThinking): void;
  addAnnotation(a: Annotation): void;
  updateAnnotation(id: string, comment: string): void;
  removeAnnotation(id: string): void;
  clearAnnotations(): void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      chatOpen: false,
      chatWidth: 420,
      chatThreadId: null,
      annotations: [],
      model: 'sonnet-4.6',
      thinking: 'medium',
      setChatOpen: (open) => set({ chatOpen: open }),
      toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
      setChatWidth: (px) => set({ chatWidth: Math.max(320, Math.min(900, px)) }),
      setChatThreadId: (id) => set({ chatThreadId: id }),
      setModel: (m) =>
        set((s) => ({
          model: m,
          // 'max' effort is opus-4.8 only — clamp it when leaving Opus.
          thinking: m !== 'opus-4.8' && s.thinking === 'max' ? 'high' : s.thinking,
        })),
      setThinking: (t) => set({ thinking: t }),
      addAnnotation: (a) => set((s) => ({ annotations: [...s.annotations, a], chatOpen: true })),
      updateAnnotation: (id, comment) =>
        set((s) => ({
          annotations: s.annotations.map((x) => (x.id === id ? { ...x, comment } : x)),
        })),
      removeAnnotation: (id) =>
        set((s) => ({ annotations: s.annotations.filter((x) => x.id !== id) })),
      clearAnnotations: () => set({ annotations: [] }),
    }),
    {
      name: projectKey('c4s:m05:chat-store'),
      version: 2,
      // v2: opus-4.7 retired in favour of opus-4.8 (Opus 4.8 release).
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<ChatState>;
        if (version < 2 && (s.model as string) === 'opus-4.7') {
          s.model = 'opus-4.8';
        }
        if (s.thinking === 'max' && s.model !== 'opus-4.8') {
          s.thinking = 'high';
        }
        return s as ChatState;
      },
      partialize: (s) => ({
        chatOpen: s.chatOpen,
        chatWidth: s.chatWidth,
        chatThreadId: s.chatThreadId,
        model: s.model,
        thinking: s.thinking,
      }),
    },
  ),
);
