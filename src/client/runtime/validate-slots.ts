/**
 * M33 load-time validation of a runtime plugin's frontend slots.
 *
 * A slot that fails is skipped with a warning rather than crashing the host. Two
 * checks:
 *   1. Structural — required render slots are functions/components.
 *   2. Pure-React chip smoke test — `renderChip` must render without an editor
 *      context (no `useEditor()` / `editor.commands.*`), because the same chip
 *      renders in the react-markdown chat pipeline where no Tiptap editor exists.
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

/** Render the chip once, detached, with no editor context. Throws → invalid. */
function chipSmokeTest(m: FrontendModule): SlotValidation {
  if (typeof document === 'undefined') return { ok: true }; // non-DOM env: skip
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    flushSync(() => {
      root.render(createElement(m.renderChip, { slug: '__c4s_smoke__', entity: null }));
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `chip render threw: ${(err as Error).message}` };
  } finally {
    try {
      flushSync(() => root.unmount());
    } catch {
      /* ignore teardown errors */
    }
  }
}

export function validateFrontendModule(m: FrontendModule): SlotValidation {
  const structural = structurallyValid(m);
  if (!structural.ok) return structural;
  return chipSmokeTest(m);
}
