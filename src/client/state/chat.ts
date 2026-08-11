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

export type ChatModel = 'fable-5' | 'sonnet-5' | 'opus-5' | 'haiku-4.5';
export type ChatThinking = 'off' | 'low' | 'medium' | 'high' | 'max';

// Models that use adaptive thinking + a reasoning-effort knob (claude_effort),
// and therefore support the 'max' effort level. Mirrors agent-adapters
// ADAPTIVE_THINKING_ONLY for the claude-code aliases we expose.
// `haiku-4.5` is the only non-adaptive model left in the catalog, so the set is
// "everything but Haiku" — spelled out rather than negated, because the next
// model added is likelier to be adaptive than not and a negation would silently
// class it wrong.
export const ADAPTIVE_MODELS: ReadonlySet<ChatModel> = new Set(['fable-5', 'sonnet-5', 'opus-5']);
export const isAdaptiveModel = (m: ChatModel): boolean => ADAPTIVE_MODELS.has(m);

// Map UI thinking level → adapter architectureConfig.
// Adaptive models (Fable 5, Sonnet 5, Opus 5) support 'adaptive' thinking only, plus a
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

const CHAT_MODELS: readonly ChatModel[] = ['fable-5', 'sonnet-5', 'opus-5', 'haiku-4.5'];
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
      model: 'opus-5',
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
      version: 3,
      // v2: the retired Opus 4.x point-release remap (superseded by v3 below).
      // v3: the whole pre-5 catalog left `ALLOWED_MODELS` in 0.2.17, so any
      // alias persisted before then is one the server no longer accepts and
      // every turn would fall into the route's invalid-alias coercion. Any
      // unrecognised value is rewritten to the new default rather than to a
      // nearest neighbour, because the reasoning CLASSES moved too — the old
      // mid tier was non-adaptive and its successor is not — so a
      // nearest-neighbour remap would silently change what the effort slider
      // means. The default is the only mapping that is honest about it.
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<ChatState>;
        if (version < 3 && !isChatModel(s.model)) {
          s.model = 'opus-5';
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
