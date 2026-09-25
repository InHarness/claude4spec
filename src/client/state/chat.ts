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

/**
 * A model alias as served by `GET /api/chat/config`. Deliberately a plain string: the
 * selectable list, its order, the default and each model's class are the SERVER's
 * contract (0.2.108) — the client renders what it receives and infers nothing from an
 * alias name.
 */
export type ChatModel = string;
export type ChatThinking = 'off' | 'low' | 'medium' | 'high' | 'max';

// Map UI thinking level → adapter architectureConfig. There is one UI control
// ("thinking"); which adapter field it drives is decided by the model's CLASS, read
// from the `adaptive` field of the config payload (never from the alias name):
// - adaptive-only → `claude_thinking: 'adaptive'` + `claude_effort` (low…max), and no
//   fixed thinking budget at any level;
// - otherwise → a fixed `claude_thinking_budget`; 'max' is adaptive-only, so it clamps
//   to 'high'.
// `adaptive === undefined` means the class is not known yet (config still loading, or
// an alias the server no longer lists): send no reasoning fields rather than guess a
// class — a budget on an adaptive-only model is exactly the mistake this avoids.
export function thinkingToConfig(
  level: ChatThinking,
  adaptive: boolean | undefined,
): Record<string, unknown> | undefined {
  if (level === 'off' || adaptive === undefined) return undefined;
  if (adaptive) return { claude_thinking: 'adaptive', claude_effort: level };
  const budget = { low: 2048, medium: 8192, high: 24000, max: 24000 }[level];
  return { claude_thinking: 'enabled', claude_thinking_budget: budget };
}

// M05 0.1.61: inverse of thinkingToConfig — derive the UI thinking level from a stored
// turn-1 architectureConfig snapshot, so a session-locked thread displays its own value.
// 'enabled'+24000 → 'high' (non-adaptive never stores 'max'; setModel clamps it on switch).
export function configToThinking(cfg: Record<string, unknown>): ChatThinking {
  const t = cfg.claude_thinking;
  if (t === 'adaptive') {
    const e = cfg.claude_effort;
    return e === 'low' || e === 'medium' || e === 'high' || e === 'max' ? e : 'medium';
  }
  if (t === 'enabled') {
    const b = cfg.claude_thinking_budget;
    if (b === 2048) return 'low';
    if (b === 8192) return 'medium';
    return 'high';
  }
  return 'off';
}

interface ChatState {
  chatOpen: boolean;
  chatWidth: number;
  chatThreadId: string | null;
  annotations: Annotation[];
  /** Global model choice; `null` = the server's default (from `GET /api/chat/config`). */
  model: ChatModel | null;
  thinking: ChatThinking;
  // One-shot seed dla inputu chatu: ustawiany tuz przed przelaczeniem watku
  // (np. „Run new thread" na patchu), konsumowany przez draft-restore effect
  // w ChatOverlay. Transient — nie persystowany, by reload nie re-seedowal.
  seedPrompt: string | null;
  setChatOpen(open: boolean): void;
  toggleChat(): void;
  setChatWidth(px: number): void;
  setChatThreadId(id: string | null): void;
  setSeedPrompt(p: string | null): void;
  /** `adaptive` = the class of `m` from the config payload; `false` clamps 'max' → 'high'. */
  setModel(m: ChatModel, adaptive?: boolean): void;
  setThinking(t: ChatThinking): void;
  addAnnotation(a: Annotation): void;
  updateAnnotation(id: string, comment: string): void;
  removeAnnotation(id: string): void;
  clearAnnotations(): void;
}

export const CHAT_MIN_WIDTH = 300;

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      chatOpen: false,
      chatWidth: 420,
      chatThreadId: null,
      annotations: [],
      model: null,
      thinking: 'medium',
      seedPrompt: null,
      setChatOpen: (open) => set({ chatOpen: open }),
      toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
      // M50: 300px … 50% of the window. The render also caps at `50vw`, so a
      // stored width stays valid when the window shrinks later.
      setChatWidth: (px) =>
        set({
          chatWidth: Math.max(
            CHAT_MIN_WIDTH,
            Math.min(typeof window === 'undefined' ? px : window.innerWidth * 0.5, px),
          ),
        }),
      setChatThreadId: (id) => set({ chatThreadId: id }),
      setSeedPrompt: (p) => set({ seedPrompt: p }),
      setModel: (m, adaptive) =>
        set((s) => ({
          model: m,
          // 'max' effort is adaptive-models only — clamp it when leaving that class.
          thinking: adaptive === false && s.thinking === 'max' ? 'high' : s.thinking,
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
      version: 4,
      // v2/v3: retired alias remaps. v4 (0.2.108): the client no longer holds a list
      // of models at all, so there is nothing to remap AGAINST here. A persisted alias
      // is kept as-is; `<ChatOverlay />` swaps an alias the server no longer lists for
      // the server's default once the config arrives, and clamps 'max' by the served
      // `adaptive` class — both decided by the payload, not by a table in the store.
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Partial<ChatState>;
        if (typeof s.model !== 'string') s.model = null;
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
