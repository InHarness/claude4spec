import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { getEntityDef } from '../../../entities/registry.js';
import { ChipResolver } from '../../../entities/ChipResolver.js';
import { categoriseBrokenChip } from '../../../core/plugin-host/host.js';
import { useRegistryVersion } from '../../../core/plugin-host/useRegistryVersion.js';
import { openEntityHandler } from '../../../entities/openEntity.js';
import { useEditorBridge } from '../../EditorContext.js';
import { useEditChipOnAltClick } from './useEditChipOnAltClick.js';
import { InlineBrokenChip } from './BrokenChip.js';
import { useCallback, useState } from 'react';
import { useReportBrokenRef } from '../../../state/brokenRefs.js';

export function InlineMentionView(props: NodeViewProps) {
  const { node } = props;
  // Re-render when a plugin frontend registers: this inline chip can mount before the
  // envelope that owns its type has finished loading. See the hook.
  useRegistryVersion();
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
  // M19: an unknown/inactive type or a missing entity counts toward the page's
  // "N broken references found" bar.
  const [missing, setMissing] = useState(false);
  const onMissing = useCallback((m: boolean) => setMissing(m), []);
  useReportBrokenRef(props.editor, { unresolvedType: !def, missingEntity: !!def && missing }, props.deleteNode);

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
      <ChipResolver type={type} slug={slug} onOpen={open} onMissing={onMissing} />
    </NodeViewWrapper>
  );
}
