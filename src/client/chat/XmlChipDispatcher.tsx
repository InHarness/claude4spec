import { getEntityDef } from '../entities/registry.js';
import { ChipResolver } from '../entities/ChipResolver.js';
import { categoriseBrokenChip } from '../core/plugin-host/host.js';
import { SectionRefChipWithData } from '../components/SectionRefChipWithData.js';
import { InlineBrokenChip } from '../tiptap/extensions/views/BrokenChip.js';
import { useEditorBridge } from '../tiptap/EditorContext.js';
import type { EntityType } from '../../shared/entities.js';
import type { SanitizedChip } from './xml-chip-preprocess.js';

/**
 * Render a single XML reference tag (one of the 6 kinds) as a chip in chat
 * markdown. All chips render inline in chat v1; block cards stay editor-only.
 *
 * Note: list-style chips (element_list / tagged_list / tagged_list_mixed)
 * render the slugs/tags inline (each entity gets a mini-chip). Forward-compat
 * slot `renderInlineCard` (M13) is not yet wired — fallback to per-slug
 * `renderChip` until the editor pipeline standardises the inline-card shape.
 */
export function XmlChipDispatcher({ chip }: { chip: SanitizedChip }) {
  if (chip.kind === 'section_ref') {
    return <SectionRefChipWithData anchor={chip.attrs.anchor ?? ''} />;
  }

  const type = chip.attrs.type ?? '';
  const slug = chip.attrs.slug ?? '';
  const slugs = (chip.attrs.slugs ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const tagsCsv = chip.attrs.tags ?? '';

  if (chip.kind === 'inline_mention' || chip.kind === 'single_element') {
    return <EntityRefChip type={type} slug={slug} />;
  }

  if (chip.kind === 'element_list') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {slugs.map((s) => (
          <EntityRefChip key={s} type={type} slug={s} />
        ))}
      </span>
    );
  }

  if (chip.kind === 'tagged_list' || chip.kind === 'tagged_list_mixed') {
    const filter = chip.attrs.filter === 'or' ? 'or' : 'and';
    const typeLabel = chip.kind === 'tagged_list' ? type : 'mixed';
    return (
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[11px] font-mono"
        style={{
          background: 'var(--c-panel)',
          color: 'var(--c-muted)',
          border: '1px solid var(--c-hair-strong)',
        }}
        title={`tagged_list ${typeLabel} · ${filter}-filter`}
      >
        <span style={{ opacity: 0.7 }}>#</span>
        <span>{tagsCsv}</span>
        <span style={{ opacity: 0.5 }}>· {typeLabel}</span>
      </span>
    );
  }

  return <span className="font-mono text-[11px]" style={{ color: 'var(--c-subtle)' }}>{`<${chip.kind}/>`}</span>;
}

function EntityRefChip({ type, slug }: { type: string; slug: string }) {
  const def = getEntityDef(type);
  const bridge = useEditorBridge();
  if (!def) {
    const category = categoriseBrokenChip(type) ?? 'unknown-type';
    return <InlineBrokenChip category={category} type={type} slug={slug} />;
  }
  return <ChipResolver type={type} slug={slug} onOpen={() => bridge?.openEntity(type as EntityType, slug)} />;
}
