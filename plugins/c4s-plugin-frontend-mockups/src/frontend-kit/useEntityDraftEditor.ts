/**
 * HOST-LOCAL — the catalog carries no state hook of this shape.
 *
 * `@c4s/plugin-runtime/ui` is a catalog of COMPONENTS (plus, from
 * `@c4s/plugin-runtime`, the L11 data hooks `useTags` / `useReferences`); it
 * publishes no debounced entity-draft editor, and the L11 surfaces it does
 * publish are read-side. So there is nothing here to import instead — this is a
 * missing surface, not a duplicated one, and it is legal on exactly that ground.
 *
 * It shrinks to a shim the day the catalog publishes a draft-editing hook.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

interface Options<E, D> {
  /** Current entity from the detail query; null/undefined while loading. */
  entity: E | null | undefined;
  /** Pure mapping entity -> editable draft. Must be module-level (referentially stable). */
  toDraft: (entity: E) => D;
  /**
   * Persist the draft and return the updated entity. Called debounced (500ms).
   * Receives the non-null entity captured at scheduling time. Panel-specific
   * post-save side effects (onRenamed, setWarnings) belong here, before returning.
   */
  save: (draft: D, entity: E) => Promise<E>;
}

export function useEntityDraftEditor<E, D>({ entity, toDraft, save }: Options<E, D>) {
  const [draft, setDraft] = useState<D | null>(null);
  const baselineRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!entity) return;
    const next = toDraft(entity);
    const snapshot = JSON.stringify(next);
    if (baselineRef.current === snapshot) return;
    baselineRef.current = snapshot;
    setDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    []
  );

  const dirty = useMemo(() => {
    if (!draft || !entity) return false;
    return JSON.stringify(draft) !== baselineRef.current;
  }, [draft, entity]);

  // Intentionally plain per-render functions (no useCallback/refs): the debounce
  // timer must fire the save closure from the render in which the edit happened,
  // mirroring the pre-refactor closure semantics exactly.
  async function runSave(current: D) {
    if (!entity) return;
    try {
      const updated = await save(current, entity);
      baselineRef.current = JSON.stringify(toDraft(updated));
    } catch (err) {
      console.error('autosave failed', err);
    }
  }

  function scheduleAutosave(next: D) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void runSave(next), 500);
  }

  function patch(partial: Partial<D>) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...partial };
      scheduleAutosave(next);
      return next;
    });
  }

  /**
   * Update the draft WITHOUT scheduling the whole-draft autosave. For a field
   * that has its own save policy — the description editor persists on blur
   * with a single-field PATCH (L8 `description` context) — the panel keeps the
   * draft in step here and persists through `saveField`.
   */
  function patchLocal(partial: Partial<D>) {
    setDraft((d) => (d ? { ...d, ...partial } : d));
  }

  /**
   * Persist ONE field now, through `persist`, and move the baseline to the
   * server's answer so `dirty` clears for it. A no-op when the field equals
   * its baseline (a blur without an edit is not a write). Other fields keep
   * their own pending edits and their debounced whole-draft save.
   */
  async function saveField<K extends keyof D>(
    key: K,
    persist: (value: D[K], entity: E) => Promise<E>,
  ) {
    if (!entity || !draft) return;
    const baseline = baselineRef.current ? (JSON.parse(baselineRef.current) as D) : null;
    if (baseline && JSON.stringify(baseline[key]) === JSON.stringify(draft[key])) return;
    try {
      const updated = await persist(draft[key], entity);
      baselineRef.current = JSON.stringify(toDraft(updated));
    } catch (err) {
      console.error('field save failed', err);
    }
  }

  return { draft, dirty, patch, patchLocal, saveField };
}
