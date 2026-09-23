import {
  ADAPTIVE_THINKING_ONLY,
  getModelContextWindow,
  resolveModel,
} from '@inharness-ai/agent-adapters';
import { SELECTABLE_MODELS, isSelectableModel } from '../../core/agent/models.js';

/**
 * Leaf module z autorytatywna lista modeli agenta po stronie serwera. Wydzielone z
 * `agent-turn.ts`, by inne moduly (np. `mcp/c4s-tools.ts`) mogly jej uzyc bez cyklu
 * importow (`agent-turn` importuje `c4s-tools`, wiec import w druga strone tworzylby
 * cykl). `agent-turn.ts` re-eksportuje stad dla zgodnosci istniejacych importerow.
 *
 * 0.2.108: sama lista zyje w `core/agent/models.ts` (obok `DEFAULT_MODEL`); tutaj
 * dochodza metadane, ktorych alias nie niesie — liczone z eksportow biblioteki.
 */
export const ALLOWED_MODELS = SELECTABLE_MODELS;
export type Model = (typeof ALLOWED_MODELS)[number];
export { isSelectableModel };

/** One entry of `GET /api/chat/config` → `architectures['claude-code'].models`. */
export interface ModelInfo {
  alias: string;
  resolvedId: string;
  /** Membership of `resolvedId` in `ADAPTIVE_THINKING_ONLY`. */
  adaptive: boolean;
  contextWindow: number;
}

/**
 * The model's class, read programmatically — NEVER from the alias name and never from
 * the context window (`opus-4.7` / `opus-4.6` are 200k and still adaptive-only). The
 * order is part of the contract: `resolveModel` first, then the membership test on the
 * RESOLVED id, which is what `ADAPTIVE_THINKING_ONLY` is keyed by.
 */
export function isAdaptiveAlias(alias: string): boolean {
  return ADAPTIVE_THINKING_ONLY.has(resolveModel('claude-code', alias));
}

/** The selectable list with its metadata, in contract order (strongest first). */
export function describeModels(): ModelInfo[] {
  return ALLOWED_MODELS.map((alias) => {
    const resolvedId = resolveModel('claude-code', alias);
    const contextWindow = getModelContextWindow('claude-code', alias);
    if (typeof contextWindow !== 'number') {
      // A selectable alias the catalog has no window for is a broken release, not a
      // runtime condition — fail loudly rather than serve a guessed denominator.
      throw new Error(`no context window for selectable model '${alias}'`);
    }
    return {
      alias,
      resolvedId,
      adaptive: ADAPTIVE_THINKING_ONLY.has(resolvedId),
      contextWindow,
    };
  });
}

/**
 * 0.2.108 — the selectable list is enforced, not just displayed. Both turn-starting
 * routes (`POST /api/chat`, `POST /api/threads/:id/ask`) call this BEFORE dispatch, so
 * the set of models shown and the set reachable are one set. Two inputs are checked:
 *
 * - the `model` the request asked for;
 * - the model the thread's turn-1 snapshot pinned. A resumable thread must keep that
 *   model, so a thread born on an alias that has since left the list cannot run at all
 *   — `400`, not the resume guard's `409`, because no request could ever satisfy it.
 *   The only way forward is a new conversation.
 *
 * An alias the LIBRARY does not know never gets this far on HTTP; `AGENT_ERROR` from
 * the runtime remains the refusal for values that bypass this gate.
 *
 * Returns the 400 body, or `null` when the turn may proceed.
 */
export function checkSelectableModel(input: {
  model: string;
  snapshotJson: string | null;
  lastSessionId: string | null;
}): { error: { code: 'VALIDATION'; message: string } } | null {
  const refuse = (message: string) => ({ error: { code: 'VALIDATION' as const, message } });
  if (!isSelectableModel(input.model)) {
    return refuse(
      `model '${input.model}' is not selectable — see GET /api/chat/config for the list`,
    );
  }
  if (input.lastSessionId != null && input.snapshotJson) {
    let pinned: unknown;
    try {
      pinned = (JSON.parse(input.snapshotJson) as { model?: unknown }).model;
    } catch {
      pinned = undefined;
    }
    if (typeof pinned === 'string' && !isSelectableModel(pinned)) {
      return refuse(
        `this thread runs on model '${pinned}', which is no longer selectable — start a new conversation`,
      );
    }
  }
  return null;
}
