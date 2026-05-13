import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { getEntityDef } from '../../../entities/registry.js';
import { categoriseBrokenChip } from '../../../core/plugin-host/host.js';
import { useEditorBridge } from '../../EditorContext.js';
import type { EntityType } from '../../../../shared/entities.js';
import { useEditChipOnAltClick } from './useEditChipOnAltClick.js';
import { InlineBrokenChip } from './BrokenChip.js';

export function InlineMentionView(props: NodeViewProps) {
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
      <NodeViewWrapper as="span" className="inline-flex align-middle" contentEditable={false}>
        <span onClickCapture={altCapture}>
          <InlineBrokenChip category={category} type={type} slug={slug} />
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className="inline-flex align-middle"
      contentEditable={false}
      onClickCapture={altCapture}
    >
      <ChipResolver type={type} slug={slug} onOpen={open} />
    </NodeViewWrapper>
  );
}

function ChipResolver({
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
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[11px]"
        style={{ background: 'var(--c-panel)', color: 'var(--c-subtle)' }}
      >
        {slug}…
      </span>
    );
  }
  const Chip = def.renderChip;
  return <Chip slug={slug} entity={data ?? null} onOpen={onOpen} />;
}
