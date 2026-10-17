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
 *  - every mounted provider registers a stable holder of its bridge here
 *    (`register`); the provider also hands that same holder object to its
 *    subtree as a React context value;
 *  - one document-level CAPTURE listener for clicks and key presses runs before
 *    React dispatches the event to the chip's handler. It starts at the event
 *    target and walks the React tree upwards (the owner chain React keeps on
 *    its host nodes) to the first provider whose holder is registered — the
 *    innermost one around the chip. The walk follows the React tree, not the
 *    DOM tree, so a chip in a portal counts as inside the provider that
 *    rendered it;
 *  - the mark lasts for that dispatch only (cleared on the next task), so a call
 *    outside any interaction falls back to the most recently mounted provider
 *    still mounted.
 *
 * The provider adds NO element to the DOM (2.1.28 system verification, round
 * 3): an earlier version wrapped every provider's children in a
 * `display: contents` div carrying React capture handlers, which put an extra
 * node between the page route, the editor's scroll container and the
 * ProseMirror view. The page editor must keep exactly the DOM it had before the
 * singleton (`editor-l8-contexts` e2e: typing into a page of a new user root).
 *
 * The `useEditorBridge()` hook stays host-internal (`tiptap/EditorContext.tsx`)
 * and is not part of `@c4s/plugin-runtime`.
 */

import type { EditorBridge } from '../tiptap/EditorContext.js';
import type { EntityType } from '../../shared/entities.js';

/** The stable object a provider registers and puts into its React context. */
export interface EditorBridgeHolder {
  current: EditorBridge;
}

interface Registration {
  id: number;
  holder: EditorBridgeHolder;
}

let nextId = 1;
/** Mounted providers, in mount order (the last one is the fallback). */
const mounted: Registration[] = [];
let active: EditorBridgeHolder | null = null;
let clearScheduled = false;
let listening = false;

function isMounted(holder: EditorBridgeHolder | null): holder is EditorBridgeHolder {
  return holder !== null && mounted.some((r) => r.holder === holder);
}

function resolve(): EditorBridge | null {
  if (isMounted(active)) return active.current;
  return mounted[mounted.length - 1]?.holder.current ?? null;
}

/** Minimal view of a React fiber: what the upward walk reads. */
interface FiberLike {
  return: FiberLike | null;
  memoizedProps?: { value?: unknown } | null;
}

/**
 * The React fiber of `node` or of its closest DOM ancestor React rendered
 * (ProseMirror's own nodes inside `EditorContent` have none, their container
 * does). React DOM stores it under a per-build `__reactFiber$<random>` key.
 */
function fiberOf(node: Node | null): FiberLike | null {
  for (let n: Node | null = node; n; n = n.parentNode) {
    for (const key of Object.keys(n)) {
      if (key.startsWith('__reactFiber$')) return (n as unknown as Record<string, FiberLike>)[key] ?? null;
    }
  }
  return null;
}

/** The innermost registered provider above `target` in the React tree. */
function nearestHolder(target: EventTarget | null): EditorBridgeHolder | null {
  if (mounted.length === 0 || !target || typeof (target as Node).nodeType !== 'number') return null;
  const holders = new Set(mounted.map((r) => r.holder));
  for (let f = fiberOf(target as Node); f; f = f.return) {
    const value = f.memoizedProps?.value;
    if (value && holders.has(value as EditorBridgeHolder)) return value as EditorBridgeHolder;
  }
  return null;
}

function onInteraction(event: Event): void {
  const holder = nearestHolder(event.target);
  if (!holder) return;
  active = holder;
  if (clearScheduled) return;
  clearScheduled = true;
  setTimeout(() => {
    active = null;
    clearScheduled = false;
  }, 0);
}

function listen(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  // Capture on the document runs before React's own listeners on its root
  // container, so the mark is set by the time the chip's handler calls us.
  document.addEventListener('click', onInteraction, true);
  document.addEventListener('keydown', onInteraction, true);
}

/** Host side of the singleton — used only by `EditorBridgeProvider`. */
export const editorBridgeRegistry = {
  /** A provider mounted with its (stable) holder: returns its id. */
  register(holder: EditorBridgeHolder): number {
    listen();
    const id = nextId++;
    mounted.push({ id, holder });
    return id;
  },
  /** A provider unmounted. */
  unregister(id: number): void {
    const i = mounted.findIndex((r) => r.id === id);
    if (i < 0) return;
    const [reg] = mounted.splice(i, 1);
    if (active === reg!.holder) active = null;
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
