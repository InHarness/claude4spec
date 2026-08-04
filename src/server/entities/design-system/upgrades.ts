import type { SnapshotData } from '../../serialization/types.js';

/**
 * `design-system` payload v1 → v2 — dropping a key the file never needed.
 *
 * v1's hand-written `snapshot()` synthesised `description: t.description ?? null`
 * onto every token, while its `restore()` stripped the key again when null
 * before writing. So the null existed in exactly one place — the entity file —
 * and nowhere else: not in the column, not in the domain object, not in any
 * view. The generated snapshot emits the stored JSON verbatim, so it does not
 * fabricate it, and the two shapes differ by that one key.
 *
 * Semantically this is nothing: an absent optional and an explicit `null` mean
 * the same thing here, `designSystemDiff` already normalises `description ?? null`
 * on both sides, and the fixpoint holds either way. It is versioned anyway
 * because the alternative is a file whose bytes change with no record of why —
 * every design system in the user's spec repo showing up in `git diff` after an
 * upgrade, with nothing to point at. A version bump costs one function and makes
 * the rewrite deliberate, immediate and explainable.
 */
export function designSystemPayloadV1ToV2(payload: SnapshotData): SnapshotData {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const p = { ...(payload as Record<string, unknown>) };
  if (!Array.isArray(p.groups)) return p;

  p.groups = (p.groups as Array<Record<string, unknown>>).map((group) => {
    if (group === null || typeof group !== 'object' || !Array.isArray(group.tokens)) return group;
    return {
      ...group,
      tokens: (group.tokens as Array<Record<string, unknown>>).map((token) => {
        if (token === null || typeof token !== 'object') return token;
        // Only an explicit null goes. A description the user actually wrote is
        // content and survives untouched.
        if (token.description !== null) return token;
        const { description: _drop, ...rest } = token;
        return rest;
      }),
    };
  });

  return p;
}
