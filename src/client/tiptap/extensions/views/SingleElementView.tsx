import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { getEntityDef } from '../../../entities/registry.js';
import { categoriseBrokenChip } from '../../../core/plugin-host/host.js';
import { useEditorBridge } from '../../EditorContext.js';
import type { EntityType } from '../../../../shared/entities.js';
import { useEditChipOnAltClick } from './useEditChipOnAltClick.js';
import { BlockBrokenChip } from './BrokenChip.js';

export function SingleElementView(props: NodeViewProps) {
  const { node } = props;
  const type = String(node.attrs.type ?? '');
  const slug = String(node.attrs.slug ?? '');
  const def = getEntityDef(type);
  const bridge = useEditorBridge();
  const open = () => bridge?.openEntity(type as EntityType, slug);
  const onAltClick = useEditChipOnAltClick(props);
  const altCapture = (e: React.MouseEvent) => {
    if (e.altKey) void onAltClick(e);
  };

  if (!def) {
    const category = categoriseBrokenChip(type) ?? 'unknown-type';
    return (
      <NodeViewWrapper className="my-3 not-prose" contentEditable={false} onClickCapture={altCapture}>
        <BlockBrokenChip category={category} type={type} slug={slug} />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3 not-prose" contentEditable={false} onClickCapture={altCapture}>
      <CardResolver type={type} slug={slug} onOpen={open} />
    </NodeViewWrapper>
  );
}

function CardResolver({
  type,
  slug,
  onOpen,
}: {
  type: string;
  slug: string;
  onOpen: () => void;
}) {
  const def = getEntityDef(type)!;
  const { data, isLoading } = def.useGetBySlug(slug);
  if (isLoading && data === undefined) {
    return (
      <div
        className="rounded-md p-3 text-[12.5px]"
        style={{ background: 'var(--c-panel)', color: 'var(--c-subtle)' }}
      >
        Loading {def.label} {slug}…
      </div>
    );
  }
  const Card = def.renderCard;
  return <Card slug={slug} entity={data ?? null} onOpen={onOpen} />;
}
