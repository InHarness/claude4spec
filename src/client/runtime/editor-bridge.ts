/**
 * M20 `m20l11sc` / `nvc5wy2p` (2.1.28): the process-wide `editorBridge`
 * singleton, exported to plugins through `@c4s/plugin-runtime`.
 *
 * Every chip — in the editor, in chat and in plugins — navigates by calling
 * `editorBridge.openEntity(type, slug)` / `editorBridge.openSection(pagePath,
 * anchor)`. The singleton has no navigation of its own: it delegates to the
 * bridge of the NEAREST `EditorBridgeProvider` (the editor pipeline's or the
 * chat pipeline's), so the same chip behaves differently in the two pipelines
 * while knowing neither of them.
 *
 * "Nearest" is decided per interaction, not by mount order:
 *  - every mounted provider registers here (`register`) and gets an id;
 *  - a provider marks itself `activate(id)` in the CAPTURE phase of a click /
 *    key press inside its React subtree. Capture runs outer → inner, so the
 *    innermost provider around the chip is the last to mark itself, and the
 *    chip's own handler (bubble phase, same dispatch) resolves to it. React
 *    synthetic events follow the React tree, so a chip in a portal counts as
 *    inside the provider that rendered it;
 *  - the mark lasts for that dispatch only (cleared on the next task), so a call
 *    outside any interaction falls back to the most recently mounted provider
 *    still mounted.
 *
 * The `useEditorBridge()` hook stays host-internal (`tiptap/EditorContext.tsx`)
 * and is not part of `@c4s/plugin-runtime`.
 */

import type { EditorBridge } from '../tiptap/EditorContext.js';
import type { EntityType } from '../../shared/entities.js';

interface Registration {
  id: number;
  bridge: EditorBridge;
}

let nextId = 1;
/** Mounted providers, in mount order (the last one is the fallback). */
const mounted: Registration[] = [];
let active: number | null = null;
let clearScheduled = false;

function find(id: number | null): Registration | undefined {
  return id === null ? undefined : mounted.find((r) => r.id === id);
}

function resolve(): EditorBridge | null {
  return (find(active) ?? mounted[mounted.length - 1])?.bridge ?? null;
}

/** Host side of the singleton — used only by `EditorBridgeProvider`. */
export const editorBridgeRegistry = {
  /** A provider mounted: returns its id. */
  register(bridge: EditorBridge): number {
    const id = nextId++;
    mounted.push({ id, bridge });
    return id;
  },
  /** A provider's bridge changed (new memoised value) — keep its place. */
  update(id: number, bridge: EditorBridge): void {
    const reg = find(id);
    if (reg) reg.bridge = bridge;
  },
  /** A provider unmounted. */
  unregister(id: number): void {
    const i = mounted.findIndex((r) => r.id === id);
    if (i >= 0) mounted.splice(i, 1);
    if (active === id) active = null;
  },
  /**
   * Called in the capture phase of an interaction inside provider `id`. The
   * innermost provider marks itself last; the mark is dropped on the next task.
   */
  activate(id: number): void {
    active = id;
    if (clearScheduled) return;
    clearScheduled = true;
    setTimeout(() => {
      active = null;
      clearScheduled = false;
    }, 0);
  },
  /** The bridge a call would reach right now (tests, diagnostics). */
  current(): EditorBridge | null {
    return resolve();
  },
};

export const editorBridge: EditorBridge = {
  openEntity(type: EntityType, slug: string): void {
    resolve()?.openEntity(type, slug);
  },
  openSection(pagePath: string, anchor: string): void {
    resolve()?.openSection(pagePath, anchor);
  },
};

export type EditorBridgeSingleton = typeof editorBridge;
