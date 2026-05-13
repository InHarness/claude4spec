import { useCallback, useEffect, useState } from 'react';

type Envelope<T> = { v: number; data: T };

type PersistedKey = `c4s:${string}:${string}`;

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
