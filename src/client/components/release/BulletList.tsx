import { useState } from 'react';
import type { Bullet } from '../../lib/release-diff/entity-diff-bullets.js';

interface Props {
  bullets: Bullet[];
}

const MAX_VALUE_LEN = 120;

/**
 * One row per delta operation, with an expand affordance where — and ONLY
 * where — the operation carries something to expand (m17uidet01).
 *
 * 0.2.31 settled the open choice between "one list" and "grouped sections":
 * one list. The eight operations are one closed dictionary, so grouping them
 * would be inventing categories the contract does not have. Three of them carry
 * content — `item_modified` (a nested list, same grammar, recursive),
 * `item_added` and `item_removed` (the full item) — and the other five say
 * everything they have to say inline. A row with no ▸ is a row with nothing
 * behind it, which is what makes the affordance worth showing at all.
 */
export function BulletList({ bullets }: Props) {
  if (bullets.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-[12.5px] font-mono">
      {bullets.map((b, i) => (
        <BulletRow key={i} bullet={b} />
      ))}
    </ul>
  );
}

function BulletRow({ bullet: b }: { bullet: Bullet }) {
  const [open, setOpen] = useState(false);
  const expandable = !!b.expandable && (!!b.children?.length || b.item !== undefined);

  return (
    <li>
      <div className="flex items-baseline gap-1.5">
        <span style={{ color: prefixColor(b.kind), width: 10, display: 'inline-block' }}>
          {prefixGlyph(b.kind)}
        </span>
        <span className="flex-1 min-w-0" style={{ color: 'var(--c-ink)' }}>
          {expandable ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-left"
              aria-expanded={open}
              style={{ color: 'var(--c-muted)' }}
            >
              <span style={{ color: 'var(--c-subtle)' }}>{open ? '▾' : '▸'}</span> {b.label}
            </button>
          ) : (
            <span style={{ color: 'var(--c-muted)' }}>{b.label}</span>
          )}
          {/* The opaque class: sizes inline, because the two values are not
              comparable and showing either would be showing a body. */}
          {b.fromBytes !== undefined && (
            <span style={{ color: 'var(--c-subtle)' }}>
              {' '}
              {b.fromBytes} B{' → '}
              {b.toBytes} B
            </span>
          )}
          {b.fromBytes === undefined && (b.from !== undefined || b.to !== undefined) && (
            <span style={{ color: 'var(--c-subtle)' }}>
              {' '}
              <ValuePreview value={b.from} />{' → '}
              <ValuePreview value={b.to} />
            </span>
          )}
        </span>
      </div>

      {open && b.children?.length ? (
        <div className="pl-5 pt-0.5">
          <BulletList bullets={b.children} />
        </div>
      ) : null}

      {open && !b.children?.length && b.item !== undefined ? (
        <pre
          className="ml-5 mt-1 rounded p-2 text-[11.5px] whitespace-pre-wrap break-words"
          style={{
            background: b.kind === 'add' ? 'rgba(16,185,129,0.08)' : 'rgba(220,38,38,0.08)',
            color: 'var(--c-ink)',
          }}
        >
          {formatValue(b.item, true)}
        </pre>
      ) : null}
    </li>
  );
}

function ValuePreview({ value }: { value: unknown }) {
  const text = formatValue(value);
  const truncated = text.length > MAX_VALUE_LEN;
  const display = truncated ? `${text.slice(0, MAX_VALUE_LEN)}…` : text;
  return <span title={truncated ? text : undefined}>{display}</span>;
}

function formatValue(value: unknown, pretty = false): string {
  if (value === null) return 'null';
  if (value === undefined) return '∅';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
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
