import type { FrontmatterDiffLite } from '../../../shared/entities.js';

interface Props {
  diff: FrontmatterDiffLite;
}

/**
 * Side-channel render dla `frontmatter_diff` (m17ui002).
 * Tabela `key | from | to` dla zmienionych + listy added/removed.
 */
export function FrontmatterDiffPanel({ diff }: Props) {
  const hasAdded = Object.keys(diff.added).length > 0;
  const hasRemoved = Object.keys(diff.removed).length > 0;
  const hasChanged = diff.changed.length > 0;
  if (!hasAdded && !hasRemoved && !hasChanged) return null;

  return (
    <div
      className="rounded-md p-2.5"
      style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
    >
      <div
        className="text-[10.5px] uppercase tracking-wider font-semibold mb-1.5"
        style={{ color: 'var(--c-subtle)' }}
      >
        Frontmatter
      </div>
      {hasChanged && (
        <ul className="space-y-0.5 text-[11.5px] font-mono">
          {diff.changed.map((c) => (
            <li key={c.key} className="flex items-baseline gap-1.5">
              <span style={{ color: '#2563eb', width: 10 }}>~</span>
              <span style={{ color: 'var(--c-muted)' }}>{c.key}</span>
              <span style={{ color: 'var(--c-subtle)' }}>
                : {fmt(c.from)} → {fmt(c.to)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {hasAdded &&
        Object.entries(diff.added).map(([k, v]) => (
          <div key={`add-${k}`} className="flex items-baseline gap-1.5 text-[11.5px] font-mono">
            <span style={{ color: '#059669', width: 10 }}>+</span>
            <span style={{ color: 'var(--c-muted)' }}>{k}</span>
            <span style={{ color: 'var(--c-subtle)' }}>: {fmt(v)}</span>
          </div>
        ))}
      {hasRemoved &&
        Object.entries(diff.removed).map(([k, v]) => (
          <div key={`rem-${k}`} className="flex items-baseline gap-1.5 text-[11.5px] font-mono">
            <span style={{ color: '#dc2626', width: 10 }}>−</span>
            <span style={{ color: 'var(--c-muted)' }}>{k}</span>
            <span style={{ color: 'var(--c-subtle)' }}>: {fmt(v)}</span>
          </div>
        ))}
    </div>
  );
}

function fmt(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
