/**
 * The four states an entity (or a page) can be in within a delta.
 *
 * Named `EntityOp` since 0.2.31 — the name `DiffOp` now belongs to the closed
 * dictionary of eight OPERATIONS a delta is made of (`shared/plugin-host/
 * data-schema.ts`). One is the envelope's state, the other is an item in its
 * `changes` list; sharing a name between them made every import a coin flip.
 *
 * `updated` is the entity spelling. Pages still say `modified` — that word is
 * M02's `FileDiff` vocabulary — so both are accepted here and coloured alike.
 */
export type EntityOp = 'created' | 'deleted' | 'updated' | 'modified' | 'noop';

export interface DiffColor {
  bg: string;
  fg: string;
}

export function colorForOp(op: EntityOp): DiffColor {
  if (op === 'created') return { bg: 'rgba(16,185,129,0.12)', fg: '#059669' };
  if (op === 'deleted') return { bg: 'rgba(220,38,38,0.12)', fg: '#dc2626' };
  if (op === 'updated' || op === 'modified') return { bg: 'rgba(59,130,246,0.12)', fg: '#2563eb' };
  return { bg: 'var(--c-panel)', fg: 'var(--c-muted)' };
}

/**
 * Spec layout (m17uidet01) labels the states `added` / `modified` / `deleted`;
 * the delta spells them `created` / `updated` / `deleted` / `noop`.
 */
export function labelForOp(op: EntityOp): string {
  if (op === 'created') return 'added';
  if (op === 'updated') return 'modified';
  return op;
}
