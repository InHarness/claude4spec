import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { getEntityDef } from '../../../entities/registry.js';
import { ChipResolver } from '../../../entities/ChipResolver.js';
import { categoriseBrokenChip } from '../../../core/plugin-host/host.js';
import { openEntityHandler } from '../../../entities/openEntity.js';
import { useEditorBridge } from '../../EditorContext.js';
import { useEditChipOnAltClick } from './useEditChipOnAltClick.js';
import { InlineBrokenChip } from './BrokenChip.js';

export function InlineMentionView(props: NodeViewProps) {
  const { node } = props;
  const type = String(node.attrs.type ?? '');
  const slug = String(node.attrs.slug ?? '');
  const def = getEntityDef(type);
  const bridge = useEditorBridge();
  // 0.2.15 — a hidden type opens its overlay; a normal one navigates.
  const open = openEntityHandler(type, slug, bridge);
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
