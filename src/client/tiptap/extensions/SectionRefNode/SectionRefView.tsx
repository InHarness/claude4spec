import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useSection } from '../../../hooks/useSection.js';
import { useEditorBridge } from '../../EditorContext.js';
import { SectionRefChip, type SectionRefChipState } from '../../../components/SectionRefChip.js';
import { openPopover } from '../../../ui/events.js';

export function SectionRefView(props: NodeViewProps) {
  const anchor = String(props.node.attrs.anchor ?? '');
  const { data, isLoading } = useSection(anchor || null);
  const bridge = useEditorBridge();

  const state: SectionRefChipState = !anchor
    ? 'broken'
    : isLoading && data === undefined
      ? 'loading'
      : data
        ? 'normal'
        : 'broken';

  const onClick = (e: React.MouseEvent) => {
    if (e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      void openPopover(
        'section',
        { x: rect.left, y: rect.bottom + 4 },
        {
          initialAnchor: anchor,
          onRemove: () => props.deleteNode(),
        },
      ).then((result) => {
        if (!result) return;
        if ('__action' in result) return;
        props.updateAttributes({ anchor: result.anchor });
      });
      return;
    }
    if (data) bridge?.openSection(data.pagePath, anchor);
  };

  return (
    <NodeViewWrapper as="span" className="inline-flex align-middle" contentEditable={false}>
      <SectionRefChip
        anchor={anchor}
        pagePath={data?.pagePath}
        headingText={data?.headingText}
        state={state}
        onClick={onClick}
      />
    </NodeViewWrapper>
  );
}
