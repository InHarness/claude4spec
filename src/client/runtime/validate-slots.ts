/**
 * M33 load-time validation of a runtime plugin's frontend slots.
 *
 * Two checks, with different blast radius:
 *   1. Structural — required render slots are functions/components. A failure
 *      skips the whole module with a warning.
 *   2. Pure-React smoke test — `renderChip` must render without
 *      an editor context (no `useEditor()` / `editor.commands.*`), because the
 *      same chip renders in the react-markdown chat pipeline where no Tiptap
 *      editor exists. A failure rejects THAT slot only (0.2.88): the host swaps
 *      in a fallback and the module still registers.
 */

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { FrontendModule } from '../core/plugin-host/types.js';
import { checkSlotShapes } from '../core/plugin-host/slot-rules.js';

export interface SlotValidation {
  ok: boolean;
  reason?: string;
}

function structurallyValid(m: FrontendModule): SlotValidation {
  // 0.2.16 — the rules are `checkSlotShapes`, the same function the plugin
  // host's throwing door calls. This used to be a second, hand-maintained copy
  // of the slot lists with a comment asking the next author to keep the two in
  // step: a plugin that passed one door and failed the other was the drift that
  // comment could only describe, not prevent.
  const problem = checkSlotShapes(m);
  return problem ? { ok: false, reason: problem } : { ok: true };
}

export type SmokeSlot = 'renderChip';

export interface SlotSmokeResult {
  /** Slots whose one render threw, with the reason. Empty = all passed. */
  rejected: Array<{ slot: SmokeSlot; reason: string }>;
}

/** Render one slot once, detached, with no editor context. */
function renderOnce(component: unknown, props: Record<string, unknown>): string | null {
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    flushSync(() => {
      root.render(createElement(component as never, props));
    });
    return null;
  } catch (err) {
    return (err as Error).message;
  } finally {
    try {
      flushSync(() => root.unmount());
    } catch {
      /* ignore teardown errors */
    }
  }
}

/**
 * 0.2.88 — the pure-React smoke test, run in the browser at `mountFrontend`
 * (the server-side `registerPlugin` has no DOM to run it in). `renderChip`
 * renders ONCE in an isolated React tree — no tiptap, no router, no data
 * providers — and a thrown exception rejects THAT slot, not the module.
 *
 * The entity handed in is `null`: the chip takes `entity: T | null` and must
 * render the M19 broken state for it, so it is the one input every plugin has
 * to survive and the only one the host can produce before any entity has been
 * resolved.
 *
 * Only the chip. The spec names `renderCard` / `renderRow` too, but neither
 * can be rendered honestly here: a card handed no entity fetches its own
 * (by contract — the host injects nothing, so it reads the record), which in
 * a detached tree means a stray request for a slug that does not exist and a
 * hook with no provider behind it — a healthy card would be rejected and a
 * request would leave the page for nothing (seen on `code-snippet`); a row's
 * contract is `entity: T` non-null and no entity of the type exists at mount
 * time. Both keep the structural check. Filed as a patch on the brief.
 *
 * Known limit (spec-documented): one render pass is behavioural, not a scan
 * for hook names — a chip that calls `useEditor()` only inside a click
 * handler passes.
 */
export function chipSmokeTest(m: FrontendModule): SlotSmokeResult {
  if (typeof document === 'undefined') return { rejected: [] }; // non-DOM env: skip
  const rejected: SlotSmokeResult['rejected'] = [];
  const reason = renderOnce(m.renderChip, { slug: '__c4s_smoke__', entity: null });
  if (reason !== null) rejected.push({ slot: 'renderChip', reason: `renderChip render threw: ${reason}` });
  return { rejected };
}

export interface FrontendModuleValidation extends SlotValidation {
  /** Present when the structure holds: the per-slot smoke outcome. */
  smoke?: SlotSmokeResult;
}

export function validateFrontendModule(m: FrontendModule): FrontendModuleValidation {
  const structural = structurallyValid(m);
  if (!structural.ok) return structural;
  return { ok: true, smoke: chipSmokeTest(m) };
}
