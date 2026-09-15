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

/**
 * Persist one field on its own — `PATCH { <field> }` — instead of through the
 * debounced whole-draft `save`. The L8 `description` context's save policy is
 * "on blur, one single-field PATCH" (spec `ctxregst`, and the DTO / Endpoint /
 * Design System detail pages); a panel declares the field here and calls
 * `saveField(key)` from the editor's `onBlur`.
 */
export type FieldSave<E, V> = (value: V, entity: E) => Promise<E>;

interface Options<E, D> {
  /** Current entity from the detail query; null/undefined while loading. */
  entity: E | null | undefined;
  /** Pure mapping entity -> editable draft. Must be module-level (referentially stable). */
  toDraft: (entity: E) => D;
  /**
   * Persist the draft and return the updated entity. Called debounced (500ms).
   * Receives the non-null entity captured at scheduling time, with every
   * `fieldSaves` field held at its BASELINE value — those fields travel only
   * through their own PATCH. Panel-specific post-save side effects (onRenamed,
   * setWarnings) belong here, before returning.
   */
  save: (draft: D, entity: E) => Promise<E>;
  /** Fields with their own save policy (see `FieldSave`). */
  fieldSaves?: { [K in keyof D]?: FieldSave<E, D[K]> };
}

export function useEntityDraftEditor<E, D extends object>({ entity, toDraft, save, fieldSaves }: Options<E, D>) {
  const [draft, setDraft] = useState<D | null>(null);
  const baselineRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  // What the pending timer would save, and the latest draft/entity, for the
  // unmount flush below. Read by closures that outlive the render.
  const pendingRef = useRef<D | null>(null);
  const latestRef = useRef<{ draft: D | null; entity: E | null | undefined }>({ draft: null, entity });
  latestRef.current = { draft, entity };
  const fieldKeys = Object.keys(fieldSaves ?? {}) as (keyof D)[];
  // Every PATCH of this entity runs through ONE chain. The whole-draft save
  // carries a single-policy field at its baseline and the field's own PATCH
  // carries the new value; sent concurrently, a last-write-wins server could
  // apply them in either order and keep the OLD value while the local baseline
  // moved to the new one — `dirty` clean, the edit gone. Serialised, each save
  // also reads the baseline the previous one left.
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  function enqueue(task: () => Promise<void>): Promise<void> {
    const next = chainRef.current.then(task, task);
    chainRef.current = next;
    return next;
  }

  useEffect(() => {
    if (!entity) return;
    const next = toDraft(entity);
    const snapshot = JSON.stringify(next);
    if (baselineRef.current === snapshot) return;
    const previous = baselineRef.current ? (JSON.parse(baselineRef.current) as D) : null;
    baselineRef.current = snapshot;
    // A refetch (a live-update event, another client's write) must not wipe
    // what the user is still typing: keep every field that differs from the
    // OLD baseline — a local, unsaved edit — and take the rest from the server.
    setDraft((current) => {
      if (!current || !previous) return next;
      const merged = { ...next };
      for (const key of Object.keys(next) as (keyof D)[]) {
        if (JSON.stringify(current[key]) !== JSON.stringify(previous[key])) merged[key] = current[key];
      }
      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  // Flush the pending whole-draft save and every dirty single-policy field.
  // Nothing else waits for a timer or a blur that will never come: tiptap's
  // `destroy()` emits no blur, keyboard navigation skips it, and a page unload
  // (reload, closed tab, lost connection) runs no React cleanup at all.
  function flushAll() {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const { draft: current, entity: live } = latestRef.current;
    const queued = pendingRef.current;
    pendingRef.current = null;
    if (queued && live) void runSave(queued, live);
    if (current && live) for (const key of fieldKeys) void runFieldSave(key, current, live);
  }
  const flushRef = useRef(flushAll);
  flushRef.current = flushAll;

  // Unmount (in-app navigation) and page unload. On unload the requests are
  // started synchronously; React has no hook there, so the window listeners
  // do it. `beforeunload` additionally asks before a dirty field is lost —
  // the browser may cancel a fetch started this late.
  useEffect(() => {
    // `beforeunload` precedes `pagehide` on the same unload; flush once.
    let unloadFlushed = false;
    const onPageHide = () => {
      if (!unloadFlushed) flushRef.current();
      unloadFlushed = false;
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      unloadFlushed = true;
      const { draft: current } = latestRef.current;
      const base = baselineRef.current ? (JSON.parse(baselineRef.current) as D) : null;
      const dirtyField =
        !!current &&
        !!base &&
        (pendingRef.current !== null ||
          fieldKeys.some((key) => JSON.stringify(current[key]) !== JSON.stringify(base[key])));
      flushRef.current();
      if (!dirtyField) return;
      e.preventDefault();
      // Legacy browsers read the return value; modern ones show their own text.
      e.returnValue = '';
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      flushRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = useMemo(() => {
    if (!draft || !entity) return false;
    return JSON.stringify(draft) !== baselineRef.current;
  }, [draft, entity]);

  function baseline(): D | null {
    return baselineRef.current ? (JSON.parse(baselineRef.current) as D) : null;
  }

  // Intentionally plain per-render functions (no useCallback/refs): the debounce
  // timer must fire the save closure from the render in which the edit happened,
  // mirroring the pre-refactor closure semantics exactly.
  function runSave(current: D, live: E): Promise<void> {
    pendingRef.current = null;
    return enqueue(async () => {
      // Single-policy fields never ride the whole-draft save: send them at
      // their baseline so an in-progress description is neither written early
      // nor duplicated by the later blur PATCH. The baseline is read HERE, once
      // the chain reaches this save, so a field PATCH that ran before it is
      // reflected.
      const base = baseline();
      const toSave = { ...current };
      if (base) for (const key of fieldKeys) toSave[key] = base[key];
      // A draft identical to the last saved state is not a save: `DocEditor`
      // normalises through tiptap and can emit a respelling of what is stored;
      // an undone edit's timer fires too. Neither deserves a version.
      if (JSON.stringify(toSave) === baselineRef.current) return;
      try {
        const updated = await save(toSave, live);
        const nextBase = toDraft(updated);
        // Keep the local value of a single-policy field the user is still
        // editing: the server answer carries the baseline we just sent.
        const before = base;
        const after = latestRef.current.draft;
        if (before && after) {
          for (const key of fieldKeys) {
            if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) nextBase[key] = before[key];
          }
        }
        baselineRef.current = JSON.stringify(nextBase);
      } catch (err) {
        console.error('autosave failed', err);
      }
    });
  }

  function runFieldSave<K extends keyof D>(key: K, current: D, live: E): Promise<void> {
    const persist = fieldSaves?.[key];
    if (!persist) return Promise.resolve();
    return enqueue(async () => {
      const base = baseline();
      if (base && JSON.stringify(base[key]) === JSON.stringify(current[key])) return;
      try {
        const updated = await persist(current[key], live);
        const nextBase = toDraft(updated);
        // The draft may have moved on for OTHER fields since; the baseline must
        // reflect only what this PATCH acknowledged.
        const stillBase = baseline();
        if (stillBase) {
          for (const k of Object.keys(nextBase) as (keyof D)[]) {
            if (k !== key) nextBase[k] = stillBase[k];
          }
        }
        baselineRef.current = JSON.stringify(nextBase);
        // Re-render so `dirty` clears for the field.
        setDraft((d) => (d ? { ...d } : d));
      } catch (err) {
        console.error('field save failed', err);
      }
    });
  }

  function scheduleAutosave(next: D) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    pendingRef.current = next;
    const live = entity;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      if (live) void runSave(next, live);
    }, 500);
  }

  /**
   * Update the draft. Fields declared in `fieldSaves` only change the local
   * draft (their PATCH is `saveField`'s); anything else schedules the
   * debounced whole-draft save.
   */
  function patch(partial: Partial<D>) {
    const wholeDraft = Object.keys(partial).some((k) => !fieldKeys.includes(k as keyof D));
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...partial };
      if (wholeDraft) scheduleAutosave(next);
      return next;
    });
  }

  /**
   * Persist ONE declared field now (`PATCH { <field> }`) and move its baseline
   * to the server's answer so `dirty` clears for it. A no-op when the field
   * equals its baseline (a blur without an edit is not a write).
   */
  async function saveField<K extends keyof D>(key: K) {
    const { draft: current, entity: live } = latestRef.current;
    if (!live || !current) return;
    await runFieldSave(key, current, live);
  }

  return { draft, dirty, patch, saveField };
}
