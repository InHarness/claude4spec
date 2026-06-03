import { useCallback, useEffect, useState } from 'react';

type Envelope<T> = { v: number; data: T };

type PersistedKey = `c4s:${string}:${string}`;

// Tozsamosc projektu wstrzyknieta przez serwer do HTML (server/index.ts → injectProjectGlobal),
// dostepna synchronicznie zanim zustand `persist` odczyta localStorage. Sluzy do suffiksowania
// project-scoped kluczy, zeby nie wyciekaly miedzy projektami na tym samym host:port.
// Brak globalu (legacy/stale cached HTML, testy) → scope 'default' (zachowanie jak przed zmiana).
declare global {
  interface Window {
    __C4S_PROJECT__?: { id: string; name?: string };
  }
}

export const PROJECT_SCOPE: string =
  (typeof window !== 'undefined' && window.__C4S_PROJECT__?.id) || 'default';

// Suffiksuje klucz scope'em projektu: 'c4s:m05:chat-store' → 'c4s:m05:chat-store::a1b2c3d4e5f6'.
// `::<scope>` jest czescia wartosci klucza, nie elementem gramatyki namespace'u.
export const projectKey = (base: PersistedKey): PersistedKey =>
  `${base}::${PROJECT_SCOPE}` as PersistedKey;

function readEnvelope<T>(
  key: PersistedKey,
  version: number,
  migrate?: (oldVersion: number, oldData: unknown) => T,
): T | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('v' in parsed) ||
      !('data' in parsed)
    ) {
      return undefined;
    }
    const env = parsed as Envelope<unknown>;
    if (typeof env.v !== 'number') return undefined;
    if (env.v === version) return env.data as T;
    if (env.v < version && migrate) return migrate(env.v, env.data);
    return undefined;
  } catch {
    return undefined;
  }
}

export function usePersistedState<T>(
  key: PersistedKey,
  defaultValue: T,
  version: number,
  migrate?: (oldVersion: number, oldData: unknown) => T,
): [T, (next: T) => void] {
  const [state, setState] = useState<T>(() => {
    const stored = readEnvelope<T>(key, version, migrate);
    return stored !== undefined ? stored : defaultValue;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const env: Envelope<T> = { v: version, data: state };
      window.localStorage.setItem(key, JSON.stringify(env));
    } catch {
      /* quota or unavailable */
    }
  }, [key, version, state]);

  const setter = useCallback((next: T) => setState(next), []);
  return [state, setter];
}

export function migrateLegacyRawKey(
  oldKey: string,
  newKey: PersistedKey,
  parse: (raw: string) => unknown,
): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(newKey) !== null) return;
    const legacy = window.localStorage.getItem(oldKey);
    if (legacy === null) return;
    const data = parse(legacy);
    if (data === undefined) return;
    const env: Envelope<unknown> = { v: 1, data };
    window.localStorage.setItem(newKey, JSON.stringify(env));
    window.localStorage.removeItem(oldKey);
  } catch {
    /* ignore */
  }
}
