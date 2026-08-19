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
    /**
     * A draft identical to the last saved state is not a save.
     *
     * This copy diverges from the one in `c4s-plugin-api-contracts`, which has
     * no such guard — deliberately, and the reason is the description editor.
     * `DocEditor` runs its content through tiptap, so it can emit an `onChange`
     * carrying a normalised spelling of what was already stored; under an
     * autosaving panel with no diff, merely OPENING a record would then write it
     * — a new version, a new `updatedAt`, a line in the release diff, for a
     * visit. `database-table`'s hand-rolled autosave has the same protection
     * (`if (Object.keys(body).length === 0) return`); the shared helper did not.
     *
     * It also covers the ordinary case that motivated it there: a debounce timer
     * firing on an edit the author typed and then undid.
     */
    if (JSON.stringify(current) === baselineRef.current) return;
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

  return { draft, dirty, patch };
}
