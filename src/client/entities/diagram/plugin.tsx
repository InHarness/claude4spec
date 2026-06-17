import { Share2, ChevronRight } from 'lucide-react';
import type { Diagram } from '../../../shared/entities.js';
import { useDiagram } from '../../hooks/useDiagrams.js';
import {
  registerEntity,
  type EntityCardProps,
  type EntityChipProps,
  type EntityRowProps,
} from '../registry.js';
import { DiagramDetail } from './detail-panel.js';

function sourceLines(d: Diagram): number {
  return d.source ? d.source.split('\n').length : 0;
}

function BrokenChip({ slug }: { slug: string }) {
  return (
    <span
      title={`broken reference: diagram '${slug}'`}
      className="inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] text-[11px] font-mono"
      style={{
        background: 'var(--c-red-soft, rgba(196,90,59,0.14))',
        color: 'var(--c-red, #c45a3b)',
        border: '1px solid var(--c-red, #c45a3b)',
      }}
    >
      ⚠ {slug}
    </span>
  );
}

function DiagramRow({ entity, active, onOpen }: EntityRowProps<Diagram>) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 transition"
      style={{ background: active ? 'var(--c-accent-soft)' : 'transparent' }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--c-panel)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <Share2 size={14} style={{ color: 'var(--c-accent)' }} />
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-mono truncate" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
          {entity.slug}
        </span>
        <span className="block text-[10.5px] font-mono uppercase tracking-wider" style={{ color: 'var(--c-subtle)' }}>
          {entity.format} · {sourceLines(entity)} lines
        </span>
      </span>
    </button>
  );
}

function DiagramChip({ slug, entity, onOpen }: EntityChipProps<Diagram>) {
  if (!entity) return <BrokenChip slug={slug} />;
  return (
    <button
      onClick={onOpen}
      className="inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] transition"
      style={{ border: '1px solid var(--c-hair)', background: 'var(--c-card)', fontSize: 12 }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair-strong)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
      title={`diagram: ${entity.slug}`}
    >
      <Share2 size={11} style={{ color: 'var(--c-accent)' }} />
      <span className="font-mono" style={{ color: 'var(--c-ink)' }}>{entity.slug}</span>
    </button>
  );
}

function DiagramCard({ slug, entity, onOpen }: EntityCardProps<Diagram>) {
  if (!entity) {
    return (
      <div
        className="rounded-md p-3"
        style={{
          background: 'var(--c-red-soft, rgba(196,90,59,0.08))',
          border: '1px dashed var(--c-red, #c45a3b)',
          color: 'var(--c-red, #c45a3b)',
        }}
      >
        <div className="text-[12px] font-mono">⚠ broken: diagram "{slug}"</div>
      </div>
    );
  }
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-md p-3 transition"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-accent)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
    >
      <div className="flex items-start gap-2">
        <Share2 size={14} style={{ color: 'var(--c-accent)', marginTop: 2 }} />
        <span className="flex-1 text-[14px] font-mono" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
          {entity.slug}
        </span>
        <ChevronRight size={14} style={{ color: 'var(--c-subtle)', marginTop: 2 }} />
      </div>
      <div className="mt-1.5 text-[10.5px] font-mono uppercase tracking-wider" style={{ color: 'var(--c-subtle)' }}>
        {entity.format} · {sourceLines(entity)} lines
      </div>
    </button>
  );
}

registerEntity<Diagram>({
  type: 'diagram',
  label: 'Diagram',
  labelPlural: 'Diagrams',
  renderRow: DiagramRow,
  renderChip: DiagramChip,
  renderCard: DiagramCard,
  detailPanel: DiagramDetail,
  useGetBySlug: (slug) => useDiagram(slug),
});
