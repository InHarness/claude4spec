import type { XmlRefsDiffLite, PageXmlRefLite } from '../../../shared/entities.js';

interface Props {
  diff: XmlRefsDiffLite;
}

/**
 * Side-channel render dla `xml_refs_diff` (m17ui002).
 * Lista added refs + lista removed refs (tagType + atrybuty).
 */
export function XmlRefsDiffPanel({ diff }: Props) {
  if (diff.added.length === 0 && diff.removed.length === 0) return null;
  return (
    <div
      className="rounded-md p-2.5"
      style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
    >
      <div
        className="text-[10.5px] uppercase tracking-wider font-semibold mb-1.5"
        style={{ color: 'var(--c-subtle)' }}
      >
        XML refs
      </div>
      {diff.added.map((r, i) => (
        <RefRow key={`add-${i}`} xmlRef={r} kind="add" />
      ))}
      {diff.removed.map((r, i) => (
        <RefRow key={`rem-${i}`} xmlRef={r} kind="remove" />
      ))}
    </div>
  );
}

function RefRow({ xmlRef, kind }: { xmlRef: PageXmlRefLite; kind: 'add' | 'remove' }) {
  const glyph = kind === 'add' ? '+' : '−';
  const color = kind === 'add' ? '#059669' : '#dc2626';
  const attrs = Object.entries(xmlRef.attributes)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  return (
    <div className="flex items-baseline gap-1.5 text-[11.5px] font-mono">
      <span style={{ color, width: 10 }}>{glyph}</span>
      <span style={{ color: 'var(--c-muted)' }}>{xmlRef.tagType}</span>
      {attrs && <span style={{ color: 'var(--c-subtle)' }}>{attrs}</span>}
    </div>
  );
}
