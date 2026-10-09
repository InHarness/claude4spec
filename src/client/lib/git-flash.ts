import { projectKey } from '../state/persisted.js';
import type { ToastVariant } from '../ui/events.js';

/**
 * 2.1.10 (M28 8i5qf0xx, toast table) — "sync `fast-forwarded` albo `merged` —
 * pokazywany po reloadzie trasy, stan przenoszony przez reload". A toast fired
 * right before `reloadProjectRoute()` dies with the page, so it is parked in
 * `sessionStorage` (per tab, per project) and shown once by the header entry
 * after the reload. Envelope `{ v, data }` as the L5 local-storage convention.
 *
 * ASSUMPTION:dev-0001 sync's 'Updated from the remote' toast crosses the route
 * reload via sessionStorage key c4s:git:flash-toast (M28 Stan declares no key).
 */
const FLASH_KEY = projectKey('c4s:git:flash-toast');
const VERSION = 1;

export interface GitFlashToast {
  variant: ToastVariant;
  message: string;
}

export function setGitFlashToast(t: GitFlashToast): void {
  try {
    window.sessionStorage.setItem(FLASH_KEY, JSON.stringify({ v: VERSION, data: t }));
  } catch {
    /* storage unavailable — the toast is simply lost with the reload */
  }
}

/** Read-and-clear: a flash toast is shown at most once. */
export function takeGitFlashToast(): GitFlashToast | null {
  try {
    const raw = window.sessionStorage.getItem(FLASH_KEY);
    if (raw === null) return null;
    window.sessionStorage.removeItem(FLASH_KEY);
    const env = JSON.parse(raw) as { v?: unknown; data?: GitFlashToast };
    if (env.v !== VERSION || !env.data || typeof env.data.message !== 'string') return null;
    return env.data;
  } catch {
    return null;
  }
}
