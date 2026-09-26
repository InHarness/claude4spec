import { useEffect, useState } from 'react';
import { projectKey } from './persisted.js';

/**
 * 0.2.113 — retired root id → its successor, per project.
 *
 * A page open in the editor when its space is renamed must move to the address
 * under the new identifier. The retired id never comes back into circulation
 * (the pair `(rootId, relPath)` is a file's identity in stored versions), so the
 * mapping is safe to keep for good. Kept in localStorage so a tab other than the
 * one that renamed follows too — the `storage` event carries it across.
 */
const KEY = projectKey('c4s:settings:root-renames');
const EVENT = 'c4s:root-renamed';

function read(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as { v?: number; data?: unknown }) : null;
    return parsed?.v === 1 && parsed.data && typeof parsed.data === 'object'
      ? (parsed.data as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

export function recordRootRename(oldId: string, newId: string): void {
  const map = read();
  // Re-point every earlier id that led to `oldId`, so a chain a→b→c resolves in one step.
  for (const [from, to] of Object.entries(map)) if (to === oldId) map[from] = newId;
  map[oldId] = newId;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, data: map }));
  } catch {
    /* storage unavailable — the redirect is a convenience, the old address still 404s */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** The identifier `rootId` was renamed to, or `null` when it is current. */
export function useRenamedRoot(rootId: string): string | null {
  const [target, setTarget] = useState<string | null>(() => read()[rootId] ?? null);
  useEffect(() => {
    const sync = () => setTarget(read()[rootId] ?? null);
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [rootId]);
  return target;
}
