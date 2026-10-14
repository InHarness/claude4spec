/**
 * 2.1.22 (M33 `m33l5man` "Zmiana frontendu już zaimportowanego przeładowuje
 * dokument") — the document reload that replaces re-importing a plugin frontend
 * already imported in this tab.
 *
 * An ES module imported in a tab cannot be unloaded, and importing the same URL
 * again returns the module already loaded — so a changed `entry` of an imported
 * plugin, or a hot-reload rebuild of an imported frontend, is taken in by
 * reloading the document. The reload waits until no editor in the tab has
 * unsaved changes (M20 `m20l11sc` rebuild invariant): until then the frontend
 * loaded earlier keeps working. The wait is re-armed on a short re-check, not
 * bounded — the user's autosave decides when it ends.
 */

import { hasUnsavedEdits } from '../tiptap/unsavedEdits.js';

export interface DocumentReloadDeps {
  /** Performs the reload. */
  reload: () => void;
  /** M20's answer to "are there unsaved editor changes in this tab". */
  hasUnsavedEdits: () => boolean;
  /** How often a deferred reload re-asks for unsaved changes. */
  recheckMs: number;
}

const defaults: DocumentReloadDeps = {
  reload: () => window.location.reload(),
  hasUnsavedEdits,
  recheckMs: 500,
};

let deps: DocumentReloadDeps = defaults;
let timer: ReturnType<typeof setInterval> | null = null;
let requested = false;

function performReload(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  deps.reload();
}

/**
 * Ask for a document reload. Immediate when nothing is unsaved; otherwise
 * deferred until the tab has no unsaved editor changes. Repeated requests while
 * one is pending collapse into it.
 */
export function requestDocumentReload(reason: string): void {
  if (requested) return;
  requested = true;
  if (!deps.hasUnsavedEdits()) {
    performReload();
    return;
  }
  console.info(`[plugin-host] ${reason} — the document reloads once unsaved changes are saved`);
  timer = setInterval(() => {
    if (!deps.hasUnsavedEdits()) performReload();
  }, deps.recheckMs);
}

/** True once a reload was asked for (pending or already performed). */
export function documentReloadRequested(): boolean {
  return requested;
}

/** True while a requested reload is waiting for unsaved changes to be saved. */
export function documentReloadDeferred(): boolean {
  return timer !== null;
}

/** Test seam: swap the dependencies and forget any earlier request. */
export function __setDocumentReloadDeps(next: Partial<DocumentReloadDeps> | null): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  requested = false;
  deps = next ? { ...defaults, ...next } : defaults;
}
