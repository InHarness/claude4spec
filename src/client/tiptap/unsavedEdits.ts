/**
 * 2.1.22 (M20 `m20l11sc`, dependency `m33-requires-m20`) — whether this tab has
 * unsaved editor changes.
 *
 * The plugin loader (M33 `m33l5man`) reloads the document when a plugin frontend
 * already imported in the tab changes, and it may do that only once nothing in
 * the tab is unsaved. M20 is the one that knows: every editor instance with an
 * autosave/save pipeline reports here whether it holds edits that have not
 * reached the server yet. The loader asks `hasUnsavedEdits()` and never reads
 * editor internals itself.
 *
 * Pull, not push: each editor registers a getter over its own refs (dirty flag,
 * writes in flight), so no editor has to remember to notify on every one of the
 * places where those refs flip.
 */

import { useEffect, useRef } from 'react';

const sources = new Set<() => boolean>();

/** Register a getter answering "this editor holds unsaved edits". Returns the disposer. */
export function registerUnsavedEditsSource(source: () => boolean): () => void {
  sources.add(source);
  return () => {
    sources.delete(source);
  };
}

/** True while any mounted editor holds edits that have not been saved. */
export function hasUnsavedEdits(): boolean {
  for (const source of sources) {
    try {
      if (source()) return true;
    } catch {
      // A broken getter must not wedge a pending reload forever, nor crash it.
    }
  }
  return false;
}

/**
 * Hook form for editor components: reports `isUnsaved()` (read live, through a
 * ref, so the latest closure is always the one asked) for as long as the
 * component is mounted. An unmounted editor holds nothing.
 */
export function useUnsavedEditsSource(isUnsaved: () => boolean): void {
  const latest = useRef(isUnsaved);
  latest.current = isUnsaved;
  useEffect(() => registerUnsavedEditsSource(() => latest.current()), []);
}
