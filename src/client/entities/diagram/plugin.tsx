import { Share2 } from 'lucide-react';
import type { Diagram } from '../../../shared/entities.js';
import { useDiagram } from '../../hooks/useDiagrams.js';
import { registerEntity, type EntityChipProps } from '../registry.js';
import { registerEditorExtension } from '../../tiptap/registry.js';
import { DiagramCard, DiagramOverlay } from './DiagramCard.js';

/**
 * 0.2.15 — what is left of the diagram's editor presence after `DiagramNode`
 * was deleted: the AUTHORING affordance and nothing else.
 *
 * No `extension` (no ProseMirror node) and no `markdownIt` rule — a diagram
 * parses and serialises as `<single_element type="diagram" …/>` through the
 * generic node. This registration exists purely so `/diagram` still appears in
 * the slash menu; `slashInvoke` opens the create popover, writes the entity,
 * and inserts the generic tag.
 *
 * The rename from the old `diagram` registration is the point: an entity
 * contributes authoring UI, never a tag.
 */
export const diagramAuthoringExtension = {
  name: 'diagram_authoring',
  priority: 670,
  availableIn: ['page', 'plan'] as const,
  slashCommand: {
    id: 'diagram',
    label: '/diagram',
    description: 'Insert a Mermaid diagram',
    hint: 'mermaid DSL',
  },
};

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

/**
 * `diagram` is a HIDDEN entity: no sidebar tab, no `routes`, no `detailPanel`,
 * and therefore no `renderRow` either.
 *
 * That is not a demotion, it is the shape being stated. Diagram never had a
 * sidebar tab or a `/diagrams/$slug` route — `bridge.openEntity('diagram', …)`
 * pointed at a route that does not exist, so the row and the detail panel were
 * unreachable surfaces satisfying a slot check. The chip opens the fullscreen
 * overlay instead of navigating.
 *
 * 0.2.16 — hidden-ness is no longer declared with a flag. Omitting `routes` and
 * `detailPanel` IS the declaration; `renderOverlay` is what the host requires in
 * exchange.
 *
 * `element_list` / `tagged_list` with `type="diagram"` are unsupported by that
 * same contract; the list views say so inline rather than rendering blanks.
 */
registerEntity<Diagram>({
  type: 'diagram',
  label: 'Diagram',
  labelPlural: 'Diagrams',
  renderChip: DiagramChip,
  renderCard: DiagramCard,
  renderOverlay: DiagramOverlay,
  useGetBySlug: (slug) => useDiagram(slug),
});

registerEditorExtension({
  ...diagramAuthoringExtension,
  availableIn: [...diagramAuthoringExtension.availableIn],
});
