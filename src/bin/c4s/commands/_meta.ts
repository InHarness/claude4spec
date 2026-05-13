import type { SerializeResult } from '../../../server/serialization/types.js';

export function withMeta(result: SerializeResult): unknown {
  if (!result.fallback && !result.error) return result.data;
  if (typeof result.data === 'object' && result.data !== null) {
    return {
      ...(result.data as object),
      ...(result.fallback ? { _fallback: true } : {}),
      ...(result.error ? { _error: result.error } : {}),
    };
  }
  return result.data;
}
