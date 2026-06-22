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

export interface SlotValidation {
  ok: boolean;
  reason?: string;
}

function structurallyValid(m: FrontendModule): SlotValidation {
  const slots: Array<keyof FrontendModule> = [
    'renderChip',
    'renderCard',
    'renderRow',
    'detailPanel',
    'useGetBySlug',
    'listByTags',
  ];
  for (const slot of slots) {
    if (typeof m[slot] !== 'function') {
      return { ok: false, reason: `slot "${String(slot)}" is not a function` };
    }
  }
  for (const ext of m.editorExtensions ?? []) {
    if (!ext || typeof ext.name !== 'string' || ext.name.length === 0) {
      return { ok: false, reason: 'an editorExtension is missing a string "name"' };
    }
  }
  return { ok: true };
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
