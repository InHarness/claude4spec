import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { getEntityDef } from '../../../entities/registry.js';
import { categoriseBrokenChip } from '../../../core/plugin-host/host.js';
import { useEditorBridge } from '../../EditorContext.js';
import type { EntityType } from '../../../../shared/entities.js';
import { useEditChipOnAltClick } from './useEditChipOnAltClick.js';
import { BlockBrokenChip } from './BrokenChip.js';

export function ElementListView(props: NodeViewProps) {
  const { node } = props;
  const type = String(node.attrs.type ?? '');
  const rawSlugs = String(node.attrs.slugs ?? '');
  const slugs = rawSlugs.split(',').map((s) => s.trim()).filter(Boolean);
  const def = getEntityDef(type);
  const bridge = useEditorBridge();
  const onAltClick = useEditChipOnAltClick(props);
  const altCapture = (e: React.MouseEvent) => {
    if (e.altKey) void onAltClick(e);
  };

  if (!def) {
    const category = categoriseBrokenChip(type) ?? 'unknown-type';
    return (
      <NodeViewWrapper className="my-3" contentEditable={false} onClickCapture={altCapture}>
        <BlockBrokenChip category={category} type={type} />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3" contentEditable={false} onClickCapture={altCapture}>
      <div
        className="rounded-md"
        style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
      >
        <div
          className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider font-mono"
          style={{ color: 'var(--c-subtle)', borderBottom: '1px solid var(--c-hair)' }}
        >
          {def.labelPlural} · {slugs.length}
        </div>
        <ul className="p-1">
          {slugs.map((slug) => (
            <li key={slug}>
              <Row
                type={type}
                slug={slug}
                onOpen={() => bridge?.openEntity(type as EntityType, slug)}
              />
            </li>
          ))}
          {slugs.length === 0 && (
            <li className="px-3 py-2 text-[12px] italic" style={{ color: 'var(--c-subtle)' }}>
              empty list
            </li>
          )}
        </ul>
      </div>
    </NodeViewWrapper>
  );
}

function Row({ type, slug, onOpen }: { type: string; slug: string; onOpen: () => void }) {
  const def = getEntityDef(type)!;
  const { data, isLoading } = def.useGetBySlug(slug);
  if (isLoading && data === undefined) {
    return (
      <div
        className="px-3 py-1.5 text-[12.5px]"
        style={{ color: 'var(--c-subtle)' }}
      >
        {slug}…
      </div>
    );
  }
  if (!data) {
    // broken ref — render chip-style warning
    const Chip = def.renderChip;
    return (
      <div className="px-2 py-1">
        <Chip slug={slug} entity={null} onOpen={onOpen} />
      </div>
    );
  }
  const RowComp = def.renderRow;
  return <RowComp slug={slug} entity={data} onOpen={onOpen} />;
}
