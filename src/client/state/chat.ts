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

export type ChatModel = 'fable-5' | 'sonnet-4.6' | 'opus-4.8' | 'haiku-4.5';
export type ChatThinking = 'off' | 'low' | 'medium' | 'high' | 'max';

// Models that use adaptive thinking + a reasoning-effort knob (claude_effort),
// and therefore support the 'max' effort level. Mirrors agent-adapters
// ADAPTIVE_THINKING_ONLY for the claude-code aliases we expose.
export const ADAPTIVE_MODELS: ReadonlySet<ChatModel> = new Set(['opus-4.8', 'fable-5']);
export const isAdaptiveModel = (m: ChatModel): boolean => ADAPTIVE_MODELS.has(m);

// Map UI thinking level → adapter architectureConfig.
// Adaptive models (Opus 4.8, Fable 5) support 'adaptive' thinking only, plus a
// reasoning-effort knob (claude_effort: low/medium/high/max) — the UI level drives
// that effort. Other models use a fixed thinking budget; 'max' is adaptive-only so
// it clamps to 'high'.
export function thinkingToConfig(
  level: ChatThinking,
  model: ChatModel,
): Record<string, unknown> | undefined {
  if (level === 'off') return undefined;
  if (isAdaptiveModel(model)) return { claude_thinking: 'adaptive', claude_effort: level };
  const budget = { low: 2048, medium: 8192, high: 24000, max: 24000 }[level];
  return { claude_thinking: 'enabled', claude_thinking_budget: budget };
}

const CHAT_MODELS: readonly ChatModel[] = ['fable-5', 'sonnet-4.6', 'opus-4.8', 'haiku-4.5'];
export const isChatModel = (m: unknown): m is ChatModel =>
  typeof m === 'string' && (CHAT_MODELS as readonly string[]).includes(m);

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
  model: ChatModel;
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
      seedPrompt: null,
      setChatOpen: (open) => set({ chatOpen: open }),
      toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
      setChatWidth: (px) => set({ chatWidth: Math.max(320, Math.min(900, px)) }),
      setChatThreadId: (id) => set({ chatThreadId: id }),
      setSeedPrompt: (p) => set({ seedPrompt: p }),
      setModel: (m) =>
        set((s) => ({
          model: m,
          // 'max' effort is adaptive-models only — clamp it when leaving that class.
          thinking: !isAdaptiveModel(m) && s.thinking === 'max' ? 'high' : s.thinking,
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
        if (s.thinking === 'max' && !isAdaptiveModel(s.model as ChatModel)) {
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
