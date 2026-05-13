export type DiffOp = 'created' | 'deleted' | 'modified' | 'noop';

export interface DiffColor {
  bg: string;
  fg: string;
}

export function colorForOp(op: DiffOp): DiffColor {
  if (op === 'created') return { bg: 'rgba(16,185,129,0.12)', fg: '#059669' };
  if (op === 'deleted') return { bg: 'rgba(220,38,38,0.12)', fg: '#dc2626' };
  if (op === 'modified') return { bg: 'rgba(59,130,246,0.12)', fg: '#2563eb' };
  return { bg: 'var(--c-panel)', fg: 'var(--c-muted)' };
}

/**
 * Spec layout (m17uidet01) używa labelek `added` / `modified` / `deleted` —
 * RawDelta zwraca `created` / `modified` / `deleted` / `noop`.
 */
export function labelForOp(op: DiffOp): string {
  if (op === 'created') return 'added';
  return op;
}
