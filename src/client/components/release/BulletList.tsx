import type { Bullet } from '../../lib/release-diff/entity-diff-bullets.js';

interface Props {
  bullets: Bullet[];
}

const MAX_VALUE_LEN = 120;

export function BulletList({ bullets }: Props) {
  if (bullets.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-[12.5px] font-mono">
      {bullets.map((b, i) => (
        <li key={i} className="flex items-baseline gap-1.5">
          <span style={{ color: prefixColor(b.kind), width: 10, display: 'inline-block' }}>
            {prefixGlyph(b.kind)}
          </span>
          <span className="flex-1 min-w-0" style={{ color: 'var(--c-ink)' }}>
            <span style={{ color: 'var(--c-muted)' }}>{b.label}</span>
            {b.kind === 'modify' && (b.from !== undefined || b.to !== undefined) && (
              <span style={{ color: 'var(--c-subtle)' }}>
                {' '}
                <ValuePreview value={b.from} />{' → '}
                <ValuePreview value={b.to} />
              </span>
            )}
            {b.kind === 'add' && b.to !== undefined && (
              <span style={{ color: 'var(--c-subtle)' }}>
                {' '}
                <ValuePreview value={b.to} />
              </span>
            )}
            {b.kind === 'remove' && b.from !== undefined && (
              <span style={{ color: 'var(--c-subtle)' }}>
                {' '}
                <ValuePreview value={b.from} />
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ValuePreview({ value }: { value: unknown }) {
  const text = formatValue(value);
  const truncated = text.length > MAX_VALUE_LEN;
  const display = truncated ? `${text.slice(0, MAX_VALUE_LEN)}…` : text;
  return (
    <span title={truncated ? text : undefined}>
      {display}
    </span>
  );
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '∅';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function prefixGlyph(kind: Bullet['kind']): string {
  if (kind === 'add') return '+';
  if (kind === 'remove') return '−';
  return '~';
}

function prefixColor(kind: Bullet['kind']): string {
  if (kind === 'add') return '#059669';
  if (kind === 'remove') return '#dc2626';
  return '#2563eb';
}
